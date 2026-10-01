import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectStatement, isCardPaymentText, readCsv, verifyBalances, type ParsedStatement } from "@app/shared";
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
    const perCard: ParsedStatement["rows"][] = [];
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
      perCard.push(result!.rows);
    }
    expect(all.length === nonZero).toBe(true);
    expect(all.some((r) => r.type === "income")).toBe(true); // o pagamento da fatura
    // o rótulo do pagamento muda de mês a mês ("Pagamento ...", "Inclusão de Pagamento"): o reconhecido tem de casar
    expect(all.some((r) => r.type === "income" && isCardPaymentText(r.description))).toBe(true);
    // coluna Parcela: "Única" ou o padrão n/m | n de m que o parser entende
    const parcelaIdx = table[0].findIndex((h) => /^parcela$/i.test(h.trim()));
    const unica = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() === "unica";
    const parcelaOk = (v: string) => unica(v) || /^(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})$/i.test(v.trim());
    expect(parcelaIdx >= 0 && body.every((cols) => parcelaOk(cols[parcelaIdx]))).toBe(true);

    // Parcelas n>1: a data da linha tem de cair na janela (mín/máx) das compras à vista do mesmo cartão, o que protege
    // contra a linha parcelada trazer a data da compra original. Sem linhas parceladas no arquivo atual isto passa
    // trivialmente: a semântica da data das parcelas segue NÃO verificada até importar uma fatura com parcelas.
    const suffix = /\s(\d{1,3})\/\d{1,3}(?: \(US\$ [\d.]+ @ [\d.]+\))?$/;
    for (const rows of perCard) {
      const dates = rows.filter((r) => !suffix.test(r.description ?? "")).map((r) => r.date).sort();
      const outside = rows.filter((r) => {
        const m = suffix.exec(r.description ?? "");
        return m !== null && Number(m[1]) > 1 && (r.date < dates[0] || r.date > dates[dates.length - 1]);
      });
      expect(outside.length === 0).toBe(true);
    }
    expect(all.some((r) => /\(US\$ [\d.]+ @ [\d.]+\)$/.test(r.description ?? ""))).toBe(true); // compra em dólar
  });
});

/** PDFs soltos em ~/Downloads (nomes quaisquer, p.ex. UUID): só os que o sistema reconhece como Mercado Pago entram. */
const DOWNLOADS = join(homedir(), "Downloads");
const PDFS = existsSync(DOWNLOADS)
  ? readdirSync(DOWNLOADS).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => join(DOWNLOADS, f))
  : [];

describe("extratos Mercado Pago reais (PDF em ~/Downloads)", () => {
  it.skipIf(PDFS.length === 0)(
    "cada extrato reconhecido é lido, sem fingerprints repetidos, com totais e saldos fechando, sempre da mesma conta",
    async (ctx) => {
      let found = 0;
      const accounts = new Set<string>();
      const allFingerprints = new Set<string>();
      let totalRows = 0;
      for (const path of PDFS) {
        let text: string;
        try {
          text = await extractPdfText(new Uint8Array(readFileSync(path)));
        } catch {
          continue; // PDF ilegível ou de outro assunto
        }
        const hit = detectStatement(text);
        if (hit?.detected.institution !== "mercado_pago") continue;
        found++;
        // asserções booleanas: uma falha nunca imprime dado real do extrato
        expect(hit.detected.kind === "statement" && hit.detected.format === "pdf_statement").toBe(true);
        expect(/^\d{6,}$/.test(hit.detected.accountRef ?? "")).toBe(true);
        accounts.add(hit.detected.accountRef!);

        // o parser já confere os totais do cabeçalho e a continuidade do saldo (e lança se não fecham);
        // a mensagem do erro não chega ao vitest
        let result: ParsedStatement | null;
        try {
          result = hit.parser.parse(text, { accountId: "real-mp" });
        } catch {
          result = null;
        }
        expect(result !== null).toBe(true);
        const parsed = result!;
        expect(parsed.rows.length > 0).toBe(true);
        expect(new Set(parsed.rows.map((r) => r.fingerprint)).size === parsed.rows.length).toBe(true);
        // rodapé, cabeçalho e marcas de página nunca entram na descrição
        expect(parsed.rows.every((r) => (r.description ?? "").length > 0 && (r.description ?? "").length < 200)).toBe(true);
        expect(parsed.rows.every((r) => !/Data de gera|Saldo final|-- \d+ of \d+ --/.test(r.description ?? ""))).toBe(true);
        expect(parsed.rows.every((r) => r.amountCents > 0 && r.postedDate === null)).toBe(true);
        expect(parsed.accountRef === hit.detected.accountRef).toBe(true);
        for (const r of parsed.rows) {
          expect(parsed.period !== null && r.date >= parsed.period.from && r.date <= parsed.period.to).toBe(true);
          allFingerprints.add(r.fingerprint);
        }
        totalRows += parsed.rows.length;

        const check = verifyBalances(parsed.rows, parsed.balances);
        expect(check !== null).toBe(true);
        expect(check!.checkpoints > 1).toBe(true);
        expect(check!.mismatches.length === 0).toBe(true);
        expect(check!.ok).toBe(true);
      }
      // sem nenhum extrato do Mercado Pago na pasta não há o que conferir
      if (found === 0) ctx.skip();
      // todos os extratos são da mesma conta, e meses diferentes não repetem fingerprint
      expect(accounts.size === 1).toBe(true);
      expect(allFingerprints.size === totalRows).toBe(true);
    },
    300_000,
  );
});
