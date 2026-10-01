import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  detectStatement,
  StatementParseError,
  verifyBalances,
  type Institution,
  type StatementFormat,
  type StatementKind,
} from "@app/shared";
import type { ImportFormat, Prisma } from "../../generated/prisma/client";
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
  /** Texto extraído; só para formatos que o preview de extrato aceita (ofx e pdf_statement). */
  text: string | null;
}

const NOT_DETECTED = { institution: null, kind: null, accountRef: null, confidence: 0, matchedAccountId: null, text: null };

function looksLikeCsv(fileName: string, text: string): boolean {
  if (/\.csv$/i.test(fileName)) return true;
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.length >= 2 && lines[0].split(/[;,]/).length >= 3;
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
        text,
      };
    }
    if (pdf) return { format: "pdf", ...NOT_DETECTED };
    if (looksLikeCsv(input.fileName, text)) return { format: "csv", ...NOT_DETECTED };
    return { format: "unknown", ...NOT_DETECTED };
  }

  /** Conta ativa cujo externalId é o número lido no arquivo; ambíguo (mais de uma) não sugere nada. */
  private async matchAccount(workspaceId: string, accountRef: string | null): Promise<string | null> {
    if (!accountRef) return null;
    const accounts = await prisma.bankAccount.findMany({
      where: { workspaceId, archived: false, externalId: accountRef },
      select: { id: true },
    });
    return accounts.length === 1 ? accounts[0].id : null;
  }

  async preview(
    workspaceId: string,
    userId: string,
    input: { accountId: string; text: string; format: StatementFormat },
  ) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: input.accountId, workspaceId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("conta não encontrada");

    const hit = detectStatement(input.text);
    if (!hit) throw new UnprocessableEntityException("não reconheci o formato do extrato");

    let parsed;
    try {
      parsed = hit.parser.parse(input.text, { accountId: account.id });
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
    const rows = parsed.rows.map((r) => ({
      ...r,
      accountId: account.id,
      dup: seen.has(r.fingerprint) || (r.fingerprint.endsWith("|0") && seen.has(r.fingerprint.slice(0, -2))),
    }));
    const dupCount = rows.filter((r) => r.dup).length;
    const balanceCheck = verifyBalances(parsed.rows, parsed.balances);

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId: account.id,
        // TODO(Fase 14, Task 2): "csv_invoice" entra no enum ImportFormat do Prisma; até lá, o cast mantém o tipo compilando.
        format: hit.detected.format as ImportFormat,
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
    };
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
