import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectStatement, verifyBalances } from "@app/shared";
import { extractPdfText } from "../../src/import/pdf-text";

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

    const parsed = hit!.parser.parse(text, { accountId: `real-${label}` });
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(new Set(parsed.rows.map((r) => r.fingerprint)).size).toBe(parsed.rows.length);

    const check = verifyBalances(parsed.rows, parsed.balances);
    expect(check !== null).toBe(true);
    expect(check!.checkpoints).toBeGreaterThan(10);
    expect(check!.mismatches.length).toBe(0);
    expect(check!.ok).toBe(true);
  });
});
