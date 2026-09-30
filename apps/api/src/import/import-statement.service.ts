import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import {
  detectStatement,
  StatementParseError,
  verifyBalances,
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

    const existing = await prisma.transaction.findMany({
      where: { workspaceId, importFingerprint: { in: parsed.rows.map((r) => r.fingerprint) } },
      select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));
    const rows = parsed.rows.map((r) => ({ ...r, accountId: account.id, dup: seen.has(r.fingerprint) }));
    const dupCount = rows.filter((r) => r.dup).length;
    const balanceCheck = verifyBalances(parsed.rows, parsed.balances);

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
    };
  }
}
