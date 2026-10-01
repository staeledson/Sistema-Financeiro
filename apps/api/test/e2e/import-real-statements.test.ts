import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectStatement, readCsv, verifyBalances, type ParsedStatement } from "@app/shared";
import { decodeText, extractPdfText } from "../../src/import/pdf-text";

const FILES = {
  PF: join(homedir(), "Downloads", "Extrato C6 Bank PF.pdf"),
  PJ: join(homedir(), "Downloads", "Extrato C6 Bank PJ.pdf"),
};

describe.each(Object.entries(FILES))("extrato C6 real (%s)", (label, path) => {
  it.skipIf(!existsSync(path))("é reconhecido como C6 e os saldos declarados fecham", async () => {
    const text = await extractPdfText(new Uint8Array(readFileSync(path)));
    const hit = detectStatement(text);
    // asserções booleanas: uma falha nunca imprime dado real do extrato
    expect(hit?.detected.institution === "c6").toBe(true);
    expect(hit?.detected.kind === "statement").toBe(true);
    expect(hit?.detected.format === "pdf_statement").toBe(true);
    expect(/^\d+$/.test(hit?.detected.accountRef ?? "")).toBe(true);

    // o erro do parser embute trecho de linha real; não deixa a mensagem chegar ao vitest
    let result: ParsedStatement | null;
    try {
      result = hit!.parser.parse(text, { accountId: `real-${label}` });
    } catch {
      result = null;
    }
    expect(result !== null).toBe(true);
    const parsed = result!;
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(new Set(parsed.rows.map((r) => r.fingerprint)).size).toBe(parsed.rows.length);

    const check = verifyBalances(parsed.rows, parsed.balances);
    expect(check !== null).toBe(true);
    expect(check!.checkpoints).toBeGreaterThan(10);
    expect(check!.mismatches.length).toBe(0);
    expect(check!.ok).toBe(true);
  });
});

const INVOICE_FILE = join(homedir(), "Downloads", "Fatura_2026-09-15.csv");

describe("fatura de cartão C6 real (CSV)", () => {
  it.skipIf(!existsSync(INVOICE_FILE))("é reconhecida, cada cartão lê sem erro, sem fingerprints repetidos e sem perder linhas", () => {
    const text = decodeText(new Uint8Array(readFileSync(INVOICE_FILE)));
    const hit = detectStatement(text);
    // asserções booleanas: uma falha nunca imprime dado real da fatura
    expect(hit?.detected.institution === "c6").toBe(true);
    expect(hit?.detected.kind === "card_invoice").toBe(true);
    expect(hit?.detected.format === "csv_invoice").toBe(true);
    const refs = hit?.detected.accountRefs ?? [];
    expect(refs.length === 2).toBe(true);

    // linhas do arquivo com valor em R$ diferente de zero (a última coluna), conferidas de forma independente do parser
    const table = readCsv(text);
    const body = table.slice(1).filter((cols) => cols.length >= 9);
    const nonZero = body.filter((cols) => Number(cols[8].replace(",", ".")) !== 0).length;

    const all: ParsedStatement["rows"] = [];
    for (const ref of refs) {
      // o erro do parser não traz conteúdo de linha, mas por garantia a mensagem não chega ao vitest
      let result: ParsedStatement | null;
      try {
        result = hit!.parser.parse(text, { accountId: `real-${ref}`, cardRef: ref });
      } catch {
        result = null;
      }
      expect(result !== null).toBe(true);
      expect(result!.rows.length > 0).toBe(true);
      expect(new Set(result!.rows.map((r) => r.fingerprint)).size === result!.rows.length).toBe(true);
      all.push(...result!.rows);
    }
    expect(all.length === nonZero).toBe(true);
    expect(all.some((r) => r.type === "income")).toBe(true); // o pagamento da fatura
    expect(all.some((r) => /\(US\$ [\d.]+ @ [\d.]+\)$/.test(r.description ?? ""))).toBe(true); // compra em dólar
  });
});
