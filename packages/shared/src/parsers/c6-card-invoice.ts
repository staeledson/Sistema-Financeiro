import { foldText } from "../categorization";
import { importFingerprint, ordinalFingerprints } from "../import";
import { readCsvLines, type CsvLine } from "./csv-lite";
import { toISODate } from "./text";
import {
  StatementParseError,
  type DetectResult,
  type ParsedRow,
  type ParsedStatement,
  type StatementParser,
} from "./types";

/** Cabeçalho esperado, já sem acento e em minúsculas (comparado coluna a coluna). */
const EXPECTED_COLUMNS = [
  "data de compra",
  "nome no cartao",
  "final do cartao",
  "categoria",
  "descricao",
  "parcela",
  "valor (em us$)",
  "cotacao (em r$)",
  "valor (em r$)",
];

const foldHeader = (cells: string[]) => cells.map((c) => foldText(c).trim());

function headerMatches(cells: string[]): boolean {
  const folded = foldHeader(cells);
  return folded.length === EXPECTED_COLUMNS.length && EXPECTED_COLUMNS.every((c, i) => folded[i] === c);
}

const DATE_BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;
// Formatos aceitos para dinheiro: "-1234.56" / "7" (ponto decimal, até 2 casas) ou BR ("1.234,56", "1234,5").
// Qualquer outro ("1.234" sem vírgula, "1,234.56") é ambíguo e vira erro, em vez de virar centavos errados.
const MONEY_DOT = /^-?\d+(\.\d{1,2})?$/;
const MONEY_BR = /^-?(\d{1,3}(\.\d{3})*|\d+),\d{1,2}$/;
const INSTALLMENT_COL = /^(\d{1,3})\s*(?:\/|de)\s*(\d{1,3})$/i;

/** Linhas de dados (sem o cabeçalho) quando o texto é uma fatura do C6; senão null. */
function readInvoice(text: string): { header: string[]; rows: CsvLine[] } | null {
  const lines = readCsvLines(text);
  if (lines.length === 0 || !headerMatches(lines[0].cells)) return null;
  return { header: lines[0].cells, rows: lines.slice(1) };
}

function columnIndex(header: string[], name: string): number {
  const idx = foldHeader(header).indexOf(name);
  if (idx < 0) throw new StatementParseError(`coluna "${name}" não encontrada no cabeçalho da fatura`);
  return idx;
}

/** Centavos inteiros (com sinal) de um valor com ponto ou vírgula decimal; null se fora dos formatos aceitos. */
function toCents(raw: string): number | null {
  const t = raw.trim();
  if (!MONEY_DOT.test(t) && !MONEY_BR.test(t)) return null;
  const s = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const cents = Math.round(Number(s) * 100);
  return Object.is(cents, -0) ? 0 : cents;
}

function distinctCards(rows: CsvLine[], cardIdx: number): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    const card = (r.cells[cardIdx] ?? "").trim();
    if (card && !seen.includes(card)) seen.push(card);
  }
  return seen;
}

export const c6CardInvoiceParser: StatementParser = {
  id: "c6-card-invoice",

  detect(text: string): DetectResult | null {
    const invoice = readInvoice(text);
    if (!invoice) return null;
    const accountRefs = distinctCards(invoice.rows, columnIndex(invoice.header, "final do cartao"));
    return {
      institution: "c6",
      kind: "card_invoice",
      format: "csv_invoice",
      accountRef: accountRefs.length === 1 ? accountRefs[0] : null,
      accountRefs,
      confidence: 0.95,
    };
  },

  parse(text: string, ctx: { accountId: string; cardRef?: string | null }): ParsedStatement {
    const invoice = readInvoice(text);
    if (!invoice) throw new StatementParseError("o arquivo não é uma fatura CSV do C6");
    const { header } = invoice;
    const col = {
      date: columnIndex(header, "data de compra"),
      card: columnIndex(header, "final do cartao"),
      category: columnIndex(header, "categoria"),
      description: columnIndex(header, "descricao"),
      installment: columnIndex(header, "parcela"),
      usd: columnIndex(header, "valor (em us$)"),
      rate: columnIndex(header, "cotacao (em r$)"),
      brl: columnIndex(header, "valor (em r$)"),
    };

    const cards = distinctCards(invoice.rows, col.card);
    let card: string;
    if (ctx.cardRef) {
      if (!cards.includes(ctx.cardRef)) {
        throw new StatementParseError("o final do cartão informado não existe no arquivo");
      }
      card = ctx.cardRef;
    } else if (cards.length > 1) {
      throw new StatementParseError("o arquivo tem mais de um cartão; escolha o final do cartão");
    } else if (cards.length === 1) {
      card = cards[0];
    } else {
      throw new StatementParseError("nenhum lançamento encontrado na fatura");
    }

    const raw: Array<{ date: string; signed: number; description: string; bankCategory: string | null }> = [];
    for (const row of invoice.rows) {
      // por desenho, linha com "Final do Cartão" vazio não pertence a nenhum cartão e é ignorada (não é erro)
      if ((row.cells[col.card] ?? "").trim() !== card) continue;
      if (row.cells.length !== header.length) {
        throw new StatementParseError(
          `linha ${row.line} com ${row.cells.length} colunas em vez de ${header.length}`,
        );
      }

      const dm = DATE_BR.exec(row.cells[col.date].trim());
      const date = dm ? toISODate(Number(dm[3]), Number(dm[2]), Number(dm[1])) : null;
      if (!date) throw new StatementParseError(`data inválida na linha ${row.line}`);

      const cents = toCents(row.cells[col.brl]);
      if (cents === null) throw new StatementParseError(`valor inválido na linha ${row.line}`);
      if (cents === 0) continue;

      let description = row.cells[col.description].replace(/\s+/g, " ").trim();

      const inst = INSTALLMENT_COL.exec(row.cells[col.installment].trim());
      if (inst) description += ` ${Number(inst[1])}/${Number(inst[2])}`;

      const usdRaw = row.cells[col.usd].trim();
      const usdCents = usdRaw === "" ? 0 : toCents(usdRaw);
      if (usdCents === null) throw new StatementParseError(`valor em US$ inválido na linha ${row.line}`);
      if (usdCents !== 0) description += ` (US$ ${usdRaw} @ ${row.cells[col.rate].trim()})`;

      const categoryRaw = row.cells[col.category].trim();
      raw.push({
        date,
        // Convenção dos demais parsers: negativo = saída. No CSV, positivo é despesa.
        signed: -cents,
        description,
        bankCategory: categoryRaw === "" || categoryRaw === "-" ? null : categoryRaw,
      });
    }

    if (raw.length === 0) throw new StatementParseError("nenhum lançamento encontrado na fatura");

    const fingerprints = ordinalFingerprints(
      raw.map((r) => importFingerprint(ctx.accountId, r.date, r.signed, r.description)),
    );
    const rows: ParsedRow[] = raw.map((r, i) => ({
      type: r.signed < 0 ? "expense" : "income",
      amountCents: Math.abs(r.signed),
      date: r.date,
      postedDate: null,
      description: r.description,
      fingerprint: fingerprints[i],
      bankCategory: r.bankCategory,
      cardRef: card,
    }));

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      balances: [],
      accountRef: card,
      period: { from: dates[0], to: dates[dates.length - 1] },
    };
  },
};
