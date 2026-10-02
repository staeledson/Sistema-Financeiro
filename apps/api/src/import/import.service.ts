import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import Papa from "papaparse";
import { Queue } from "bullmq";
import { csvMappingSchema, csvRowToTransaction, ordinalFingerprints, parseInstallment, reserveDirection } from "@app/shared";
import { prisma } from "../database";
import { StorageService } from "../storage/storage.service";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "../ingest/ingest.types";
import { TransactionsService } from "../transactions/transactions.service";

@Injectable()
export class ImportService {
  constructor(
    private readonly storage: StorageService,
    @Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>,
    private readonly transactions: TransactionsService,
  ) {}

  async csvPreview(
    workspaceId: string,
    userId: string,
    accountId: string,
    mappingRaw: unknown,
    csv: string,
  ) {
    const mapping = csvMappingSchema.parse(mappingRaw);
    const account = await prisma.bankAccount.findFirst({ where: { id: accountId, workspaceId }, select: { id: true } });
    if (!account) throw new NotFoundException("conta não encontrada");
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const txs = parsed.data.map((r) => csvRowToTransaction(r, mapping, accountId));

    // `fingerprint` de csvRowToTransaction é a chave base (formato legado); o ordinal separa linhas idênticas.
    const legacyKeys = txs.map((t) => t.fingerprint);
    const fingerprints = ordinalFingerprints(legacyKeys);
    const existing = await prisma.transaction.findMany({
      where: { workspaceId, importFingerprint: { in: [...fingerprints, ...legacyKeys] } },
      select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));

    const rows = txs.map((t, i) => {
      const isFirstOfKey = fingerprints[i].endsWith("|0");
      return {
        ...t,
        fingerprint: fingerprints[i],
        // importações antigas gravaram só a chave base (e descartaram as repetidas): ela vale para a 1ª ocorrência
        dup: seen.has(fingerprints[i]) || (isFirstOfKey && seen.has(legacyKeys[i])),
      };
    });
    const dupCount = rows.filter((r) => r.dup).length;

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId,
        format: "csv",
        status: "preview",
        rowCount: rows.length,
        dupCount,
        createdById: userId,
      },
      select: { id: true },
    });

    return { batchId: batch.id, rows, rowCount: rows.length, dupCount };
  }

  async commit(
    workspaceId: string,
    userId: string,
    batchId: string,
    rows: Array<{
      type: "income" | "expense";
      amountCents: number;
      date: string;
      postedDate?: string | null;
      accountId: string;
      description: string | null;
      categoryId?: string | null;
      fingerprint: string;
    }>,
  ) {
    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, workspaceId },
      select: { id: true, undoneAt: true },
    });
    if (!batch) throw new NotFoundException("lote não encontrado");
    // lote desfeito não volta a ser gravado: as linhas ficariam órfãs (undoneAt fica marcado e novo undo dá 409)
    if (batch.undoneAt) throw new ConflictException("o lote foi desfeito; gere um novo preview");

    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const ownedAccounts = await prisma.bankAccount.findMany({
      where: { id: { in: accountIds }, workspaceId },
      select: { id: true, type: true, entity: true, institution: true },
    });
    if (ownedAccounts.length !== accountIds.length) throw new BadRequestException("conta inexistente no workspace");

    const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter((c): c is string => !!c))];
    if (categoryIds.length) {
      const ownedCats = await prisma.category.count({ where: { id: { in: categoryIds }, workspaceId } });
      if (ownedCats !== categoryIds.length) throw new BadRequestException("categoria inexistente no workspace");
    }

    // parcela "n/m" só em despesa de cartão de crédito, a mesma regra do lançamento manual
    const cardIds = new Set(ownedAccounts.filter((a) => a.type === "credit_card").map((a) => a.id));
    const reserveOf = await this.reserveAccounts(workspaceId, ownedAccounts);
    const payload = rows.map((r) => {
      const inst = r.type === "expense" && cardIds.has(r.accountId) ? parseInstallment(r.description) : null;
      // guardar/retirar da reserva é dinheiro do próprio titular: vira transferência entre a conta e a reserva
      const reserveId = reserveOf.get(r.accountId);
      const direction = reserveId ? reserveDirection(r.type, r.description) : null;
      if (reserveId && direction) {
        return {
          workspaceId,
          type: "transfer" as const,
          amountCents: BigInt(r.amountCents),
          date: new Date(r.date),
          postedDate: r.postedDate ? new Date(r.postedDate) : null,
          accountId: r.accountId,
          sourceAccountId: direction === "to_reserve" ? r.accountId : reserveId,
          destAccountId: direction === "to_reserve" ? reserveId : r.accountId,
          categoryId: null,
          description: r.description,
          source: "import",
          categorySource: "none" as const,
          reviewStatus: "ok" as const,
          installmentCurrent: null,
          installmentTotal: null,
          importFingerprint: r.fingerprint,
          importBatchId: batchId,
          createdById: userId,
        };
      }
      return {
        workspaceId,
        type: r.type,
        amountCents: BigInt(r.amountCents),
        date: new Date(r.date),
        postedDate: r.postedDate ? new Date(r.postedDate) : null,
        accountId: r.accountId,
        categoryId: r.categoryId ?? null,
        description: r.description,
        source: "import",
        sourceAccountId: null,
        destAccountId: null,
        categorySource: r.categoryId ? ("import" as const) : ("none" as const),
        reviewStatus: undefined,
        installmentCurrent: inst?.current ?? null,
        installmentTotal: inst?.total ?? null,
        importFingerprint: r.fingerprint,
        importBatchId: batchId,
        createdById: userId,
      };
    });

    // o CSV marca como duplicata a 1ª ocorrência gravada só com a chave legada (sem ordinal): não gravar outra cópia
    const legacyBases = [...new Set(payload.filter((p) => p.importFingerprint.endsWith("|0")).map((p) => p.importFingerprint.slice(0, -2)))];
    const legacyExisting = legacyBases.length
      ? await prisma.transaction.findMany({
          where: { workspaceId, importFingerprint: { in: legacyBases } },
          select: { importFingerprint: true },
        })
      : [];
    const legacySeen = new Set(legacyExisting.map((e) => e.importFingerprint));
    const toInsert = payload.filter((p) => !(p.importFingerprint.endsWith("|0") && legacySeen.has(p.importFingerprint.slice(0, -2))));

    const inserted = await prisma.$transaction(async (tx) => {
      // a troca condicional de status serializa o commit com um desfazer concorrente
      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, workspaceId, undoneAt: null },
        data: { status: "committed" },
      });
      if (claimed.count === 0) throw new ConflictException("o lote foi desfeito; gere um novo preview");
      const { count } = await tx.transaction.createMany({ data: toInsert, skipDuplicates: true });
      return count;
    }, { timeout: 30_000 });

    if (inserted > 0) {
      try {
        await this.transactions.enqueueCategorizationJob(workspaceId, userId, batchId);
      } catch (err) {
        // categorização é enriquecimento assíncrono; falha aqui não invalida a importação já gravada
        console.error("[import] falha ao enfileirar categorização do lote", batchId, err);
      }
    }

    return { inserted, skipped: rows.length - inserted };
  }

  /**
   * Conta de reserva de cada conta de origem: a única conta de poupança ativa da mesma entidade (PF/PJ) e do Mercado
   * Pago (os textos de reserva são do extrato dele). Zero ou mais de uma candidata → sem reserva (o movimento segue
   * como despesa/receita). Nunca decide por nome, para não depender de como o usuário batizou a conta.
   */
  private async reserveAccounts(
    workspaceId: string,
    sources: Array<{ id: string; type: string; entity: string; institution: string }>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const savings = await prisma.bankAccount.findMany({
      where: { workspaceId, type: "savings", archived: false, institution: "mercado_pago" },
      select: { id: true, entity: true, institution: true },
    });
    for (const src of sources) {
      if (src.type === "savings" || src.type === "credit_card" || src.institution !== "mercado_pago") continue;
      const candidates = savings.filter((a) => a.entity === src.entity && a.institution === src.institution);
      if (candidates.length === 1) out.set(src.id, candidates[0].id);
    }
    return out;
  }

  async enqueuePdf(workspaceId: string, userId: string, storagePath: string) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind: "parse_invoice", inputRef: storagePath, createdById: userId },
      select: { id: true },
    });

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        format: "pdf",
        status: "preview",
        fileRef: storagePath,
        createdById: userId,
      },
      select: { id: true },
    });

    await this.queue.add("ingest", {
      jobId: job.id,
      workspaceId,
      userId,
      kind: "parse_invoice",
      storagePath,
    } as IngestJobData);

    return { jobId: job.id, batchId: batch.id };
  }

  async listMappings(workspaceId: string) {
    return prisma.importMapping.findMany({
      where: { workspaceId },
      select: { id: true, name: true, format: true, mapping: true },
      orderBy: { name: "asc" },
    });
  }

  async saveMapping(
    workspaceId: string,
    name: string,
    format: "csv" | "ofx" | "pdf",
    mapping: unknown,
  ) {
    return prisma.importMapping.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name, format, mapping: mapping as object },
      update: { mapping: mapping as object, format },
      select: { id: true, name: true },
    });
  }
}
