import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  categoryFits,
  detectStatement,
  foldText,
  mapBankCategory,
  StatementParseError,
  verifyBalances,
  type BalancePoint,
  type Institution,
  type StatementFormat,
  type StatementKind,
} from "@app/shared";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database";
import { decodeText, extractPdfText, isPdf } from "./pdf-text";

export type DetectedFormat = StatementFormat | "csv" | "pdf" | "unknown";

export interface DetectResponse {
  format: DetectedFormat;
  institution: Institution | null;
  kind: StatementKind | null;
  accountRef: string | null;
  confidence: number;
  matchedAccountId: string | null;
  /** Finais de cartão distintos de uma fatura (vazio nos demais formatos). */
  accountRefs: string[];
  /** Por final de cartão: id da única conta ativa de cartão de crédito com esse externalId; senão null. */
  matchedAccounts: Record<string, string | null>;
  /** Texto extraído (PDF ou arquivo de texto); null quando o formato não foi reconhecido. */
  text: string | null;
}

const NOT_DETECTED = {
  institution: null,
  kind: null,
  accountRef: null,
  confidence: 0,
  matchedAccountId: null,
  accountRefs: [],
  matchedAccounts: {},
  text: null,
};

const CARD_INVOICE_NEEDS_CARD = "este arquivo é uma fatura de cartão; escolha uma conta do tipo cartão de crédito";

function looksLikeCsv(fileName: string, text: string): boolean {
  if (/\.csv$/i.test(fileName)) return true;
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.length >= 2 && lines[0].split(/[;,]/).length >= 3;
}

/**
 * Saldo corrente que o próprio arquivo declara (momento da exportação), ou null. Só o ponto marcado `current`
 * serve: os demais valem para a data deles, não para hoje, e não se adivinha. Havendo mais de um, vale o de data mais recente.
 */
export function currentStatementBalance(balances: BalancePoint[]): { dateISO: string; balanceCents: number; current: true } | null {
  let best: BalancePoint | null = null;
  for (const p of balances) if (p.current === true && (!best || p.dateISO >= best.dateISO)) best = p;
  return best ? { dateISO: best.dateISO, balanceCents: best.balanceCents, current: true } : null;
}

@Injectable()
export class ImportStatementService {
  async detect(workspaceId: string, input: { fileName: string; contentBase64: string }): Promise<DetectResponse> {
    const bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
    if (bytes.length === 0) throw new BadRequestException("arquivo vazio");

    const pdf = isPdf(bytes);
    let text: string;
    if (pdf) {
      try {
        text = await extractPdfText(bytes);
      } catch {
        throw new UnprocessableEntityException("não consegui ler o PDF");
      }
    } else {
      text = decodeText(bytes);
    }

    const hit = detectStatement(text);
    if (hit) {
      const { detected } = hit;
      return {
        format: detected.format,
        institution: detected.institution,
        kind: detected.kind,
        accountRef: detected.accountRef,
        confidence: detected.confidence,
        matchedAccountId: await this.matchAccount(workspaceId, detected.accountRef),
        accountRefs: detected.accountRefs ?? [],
        matchedAccounts: await this.matchCards(workspaceId, detected.accountRefs ?? []),
        text,
      };
    }
    if (pdf) return { format: "pdf", ...NOT_DETECTED };
    if (looksLikeCsv(input.fileName, text)) return { format: "csv", ...NOT_DETECTED };
    return { format: "unknown", ...NOT_DETECTED };
  }

  /**
   * Conta ativa cujo externalId é o número lido no arquivo, comparados pelos dígitos (o usuário cadastra
   * "1664591878-9" e o PDF traz "16645918789"); ambíguo (mais de uma) não sugere nada.
   */
  private async matchAccount(workspaceId: string, accountRef: string | null): Promise<string | null> {
    if (!accountRef) return null;
    const wanted = accountRef.replace(/\D/g, "");
    const accounts = await prisma.bankAccount.findMany({
      where: { workspaceId, archived: false, externalId: { not: null } },
      select: { id: true, externalId: true },
    });
    // referência sem dígitos (raro) só casa por texto exato
    const matches = accounts.filter(
      (a) => a.externalId === accountRef || (wanted !== "" && a.externalId!.replace(/\D/g, "") === wanted),
    );
    return matches.length === 1 ? matches[0].id : null;
  }

  /** Por final de cartão, a única conta ativa de cartão de crédito com esse externalId; ambíguo ou inexistente vira null. */
  private async matchCards(workspaceId: string, refs: string[]): Promise<Record<string, string | null>> {
    if (refs.length === 0) return {};
    const accounts = await prisma.bankAccount.findMany({
      where: { workspaceId, archived: false, type: "credit_card", externalId: { in: refs } },
      select: { id: true, externalId: true },
    });
    const out: Record<string, string | null> = {};
    for (const ref of refs) {
      const matches = accounts.filter((a) => a.externalId === ref);
      out[ref] = matches.length === 1 ? matches[0].id : null;
    }
    return out;
  }

  /** Categoria sugerida pela categoria do banco: só despesa, só categoria do workspace que serve à entidade da conta. */
  private async suggestCategories<T extends { type: "income" | "expense"; bankCategory?: string | null }>(
    workspaceId: string,
    entity: "pf" | "pj" | null,
    rows: T[],
  ): Promise<Array<T & { categoryId: string | null; bankCategory: string | null }>> {
    const wanted = rows.some((r) => r.type === "expense" && mapBankCategory(r.bankCategory));
    const byName = new Map<string, { id: string; type: "income" | "expense"; entity: "pf" | "pj" | "both" }>();
    if (wanted) {
      const categories = await prisma.category.findMany({
        where: { workspaceId, type: "expense" },
        select: { id: true, name: true, type: true, entity: true },
        // ordem fixa: com nomes repetidos a sugestão é sempre a mesma categoria
        orderBy: { id: "asc" }, // Category não tem createdAt; o id (cuid) é monotônico o bastante
      });
      for (const c of categories) {
        const key = foldText(c.name.trim());
        // nomes iguais (raro): a categoria que serve à entidade da conta vence
        const prev = byName.get(key);
        if (!prev || (!categoryFits(prev, { type: "expense" }, entity) && categoryFits(c, { type: "expense" }, entity))) byName.set(key, c);
      }
    }
    return rows.map((r) => {
      const name = r.type === "expense" ? mapBankCategory(r.bankCategory) : null;
      const cat = name ? byName.get(foldText(name)) : undefined;
      const fits = cat && categoryFits(cat, { type: r.type }, entity);
      return { ...r, bankCategory: r.bankCategory ?? null, categoryId: fits ? cat.id : null };
    });
  }

  async preview(
    workspaceId: string,
    userId: string,
    input: { accountId: string; text: string; format: StatementFormat; cardRef?: string | null },
  ) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: input.accountId, workspaceId },
      select: { id: true, type: true, entity: true },
    });
    if (!account) throw new NotFoundException("conta não encontrada");

    const hit = detectStatement(input.text);
    if (!hit) throw new UnprocessableEntityException("não reconheci o formato do extrato");

    if (hit.detected.kind === "card_invoice" && account.type !== "credit_card") {
      throw new BadRequestException(CARD_INVOICE_NEEDS_CARD);
    }

    let parsed;
    try {
      parsed = hit.parser.parse(input.text, { accountId: account.id, cardRef: input.cardRef ?? null });
    } catch (err) {
      // a mensagem pode conter trecho do extrato do usuário: vai na resposta 422, nunca para o log
      if (err instanceof StatementParseError) throw new UnprocessableEntityException(err.message);
      throw err;
    }

    const fingerprints = parsed.rows.map((r) => r.fingerprint);
    // importações antigas gravaram só a chave base (sem ordinal): ela vale para a 1ª ocorrência, como no commit
    const legacyBases = [...new Set(fingerprints.filter((f) => f.endsWith("|0")).map((f) => f.slice(0, -2)))];
    const existing = await prisma.transaction.findMany({
      where: { workspaceId, importFingerprint: { in: [...fingerprints, ...legacyBases] } },
      select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));
    const suggested = await this.suggestCategories(workspaceId, account.entity, parsed.rows);
    const rows = suggested.map((r) => ({
      ...r,
      accountId: account.id,
      dup: seen.has(r.fingerprint) || (r.fingerprint.endsWith("|0") && seen.has(r.fingerprint.slice(0, -2))),
    }));
    const dupCount = rows.filter((r) => r.dup).length;
    const balanceCheck = verifyBalances(parsed.rows, parsed.balances);
    const statementBalance = currentStatementBalance(parsed.balances);
    const laterActivity = statementBalance
      ? await this.hasLaterActivity(workspaceId, account.id, statementBalance.dateISO, [...fingerprints, ...legacyBases])
      : false;

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId: account.id,
        format: hit.detected.format,
        institution: hit.detected.institution,
        detectedAccountRef: parsed.accountRef,
        balanceCheck: balanceCheck ? (balanceCheck as unknown as Prisma.InputJsonValue) : undefined,
        status: "preview",
        rowCount: rows.length,
        dupCount,
        createdById: userId,
      },
      select: { id: true },
    });

    return {
      batchId: batch.id,
      institution: hit.detected.institution,
      accountRef: parsed.accountRef,
      period: parsed.period,
      rows,
      rowCount: rows.length,
      dupCount,
      balanceCheck,
      statementBalance,
      laterActivity,
    };
  }

  /**
   * A conta tem lançamento datado DEPOIS do saldo corrente do extrato? Então o saldo do extrato já não é o de hoje e
   * ajustar o saldo inicial por ele seria errado. Calculado no preview (linhas do lote ainda não inseridas); as linhas
   * deste mesmo extrato que já existem (reimportação) são excluídas pela impressão digital, pois o saldo corrente do
   * banco as inclui. Lançamentos feitos entre o preview e a confirmação não entram: a conciliação é sempre manual.
   */
  private async hasLaterActivity(workspaceId: string, accountId: string, dateISO: string, ownFingerprints: string[]): Promise<boolean> {
    const hit = await prisma.transaction.findFirst({
      where: {
        workspaceId,
        date: { gt: new Date(`${dateISO}T00:00:00Z`) },
        OR: [{ accountId }, { sourceAccountId: accountId }, { destAccountId: accountId }],
        AND: [{ OR: [{ importFingerprint: null }, { importFingerprint: { notIn: ownFingerprints } }] }],
      },
      select: { id: true },
    });
    return hit !== null;
  }

  /** Apaga as transações do lote e registra `undoneAt`. O lote precisa estar confirmado e ainda não desfeito. */
  async undo(workspaceId: string, batchId: string) {
    return prisma.$transaction(async (tx) => {
      // o updateMany condicional é o portão atômico: de dois undos simultâneos só um encontra o lote elegível
      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, workspaceId, status: "committed", undoneAt: null },
        data: { undoneAt: new Date() },
      });
      if (claimed.count === 0) {
        const batch = await tx.importBatch.findFirst({
          where: { id: batchId, workspaceId },
          select: { status: true, undoneAt: true },
        });
        if (!batch) throw new NotFoundException("lote não encontrado");
        if (batch.status !== "committed") throw new ConflictException("o lote ainda não foi confirmado");
        throw new ConflictException("o lote já foi desfeito");
      }
      // contrapartes de fora do lote perdem o par: voltam para a fila de revisão
      const pairs = await tx.transaction.findMany({
        where: { workspaceId, importBatchId: batchId, transferPairId: { not: null } },
        select: { transferPairId: true },
      });
      const pairIds = [...new Set(pairs.map((p) => p.transferPairId!))];
      if (pairIds.length) {
        const outside = { workspaceId, transferPairId: { in: pairIds }, OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }] };
        // sem categoria: volta para a fila de revisão; com categoria: só perde o par (mantém categoria, origem e status)
        await tx.transaction.updateMany({
          where: { ...outside, categoryId: null },
          data: { transferPairId: null, reviewStatus: "pending", categorySource: "none" },
        });
        await tx.transaction.updateMany({
          where: { ...outside, categoryId: { not: null } },
          data: { transferPairId: null },
        });
      }
      const removed = await tx.transaction.deleteMany({ where: { workspaceId, importBatchId: batchId } });
      return { removed: removed.count };
    });
  }

  async listBatches(workspaceId: string) {
    const batches = await prisma.importBatch.findMany({
      where: { workspaceId, status: "committed" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        format: true,
        institution: true,
        rowCount: true,
        dupCount: true,
        balanceCheck: true,
        createdAt: true,
        undoneAt: true,
        account: { select: { name: true } },
        _count: { select: { transactions: true } },
      },
    });
    return batches.map((b) => ({
      id: b.id,
      format: b.format,
      institution: b.institution,
      accountName: b.account?.name ?? null,
      rowCount: b.rowCount,
      dupCount: b.dupCount,
      inserted: b._count.transactions,
      balanceOk: b.balanceCheck ? (b.balanceCheck as { ok: boolean }).ok : null,
      createdAt: b.createdAt,
      undoneAt: b.undoneAt,
    }));
  }
}
