import { importFingerprint, ordinalFingerprints } from "../import";
import { inferYearISO, parseBrlCents, parsePtLongDate, splitCells, toISODate } from "./text";
import {
  StatementParseError,
  type BalancePoint,
  type DetectResult,
  type ParsedRow,
  type ParsedStatement,
  type StatementParser,
} from "./types";

const MONTH_BLOCK = /^\S+ \d{4} \( (\d{2})\/(\d{2})\/(\d{4}) - (\d{2})\/(\d{2})\/(\d{4}) \)/;
const BALANCE_DAY = /^Saldo do dia (\d{2})\/(\d{2})\/(\d{2})\s+(-?\s*R\$\s*[\d.]+,\d{2})$/;
const BALANCE_EXPORT = /^Saldo do dia \S+ (\d{1,2}) de (\S+) de (\d{4}) \S+ (-?\s*R\$\s*[\d.]+,\d{2})$/;
const PERIOD = /Período \S+ (\d{1,2}) de (\S+) de (\d{4}) até (\d{1,2}) de (\S+) de (\d{4})/;
const ACCOUNT = /Ag[eê]ncia:\s*\d+\s+\S+\s+Conta:\s*(\d+)/;
const DAY_MONTH = /^(\d{2})\/(\d{2})$/;

function normalize(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export const c6StatementParser: StatementParser = {
  id: "c6-statement",

  detect(text: string): DetectResult | null {
    const t = text.normalize("NFC");
    const hasMonthBlock = /^\s*\S+ \d{4} \( \d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4} \)/m.test(t);
    const hasColumns = /lançamento/i.test(t) && /contábil/i.test(t);
    const hasBalance = /Saldo do dia/.test(t);
    if (!(hasMonthBlock && hasColumns && hasBalance)) return null;
    return {
      institution: "c6",
      kind: "statement",
      format: "pdf_statement",
      accountRef: t.match(ACCOUNT)?.[1] ?? null,
      confidence: /C6 Bank/i.test(t) ? 0.95 : 0.85,
    };
  },

  parse(text: string, ctx: { accountId: string }): ParsedStatement {
    const lines = normalize(text);
    let block: { from: string; to: string } | null = null;
    let accountRef: string | null = null;
    let period: ParsedStatement["period"] = null;
    const balances: BalancePoint[] = [];
    const raw: Array<{ date: string; postedDate: string; signed: number; description: string }> = [];

    for (const line of lines) {
      accountRef ??= line.match(ACCOUNT)?.[1] ?? null;

      const per = line.match(PERIOD);
      if (per) {
        const from = parsePtLongDate(per[1], per[2], per[3]);
        const to = parsePtLongDate(per[4], per[5], per[6]);
        if (from && to) period = { from, to };
        continue;
      }

      const exported = line.match(BALANCE_EXPORT);
      if (exported) {
        const dateISO = parsePtLongDate(exported[1], exported[2], exported[3]);
        const balanceCents = parseBrlCents(exported[4]);
        if (dateISO && balanceCents !== null) balances.push({ dateISO, balanceCents, current: true });
        continue;
      }

      const blockMatch = line.match(MONTH_BLOCK);
      if (blockMatch) {
        const from = toISODate(Number(blockMatch[3]), Number(blockMatch[2]), Number(blockMatch[1]));
        const to = toISODate(Number(blockMatch[6]), Number(blockMatch[5]), Number(blockMatch[4]));
        if (!from || !to) throw new StatementParseError(`período do mês inválido: "${line.slice(0, 60)}"`);
        block = { from, to };
        continue;
      }

      const day = line.match(BALANCE_DAY);
      if (day) {
        const dateISO = toISODate(2000 + Number(day[3]), Number(day[2]), Number(day[1]));
        const balanceCents = parseBrlCents(day[4]);
        if (!dateISO || balanceCents === null) throw new StatementParseError(`saldo do dia inválido: "${line}"`);
        balances.push({ dateISO, balanceCents });
        continue;
      }

      const cells = splitCells(line);
      const launched = cells.length >= 2 ? DAY_MONTH.exec(cells[0]) : null;
      const posted = cells.length >= 2 ? DAY_MONTH.exec(cells[1]) : null;
      if (!launched || !posted) continue;
      if (cells.length !== 5) {
        throw new StatementParseError(
          `linha de lançamento com ${cells.length} colunas em vez de 5: "${line.slice(0, 80)}"`,
        );
      }

      if (!block) throw new StatementParseError("lançamento encontrado antes do cabeçalho do mês");
      const cents = parseBrlCents(cells[4]);
      if (cents === null) throw new StatementParseError(`valor inválido: "${cells[4]}"`);
      const date = inferYearISO(Number(launched[1]), Number(launched[2]), block.from, block.to);
      const postedDate = inferYearISO(Number(posted[1]), Number(posted[2]), block.from, block.to);
      if (!date || !postedDate) throw new StatementParseError(`data inválida: "${cells[0]}" / "${cells[1]}"`);
      if (cents === 0) continue;
      raw.push({ date, postedDate, signed: cents, description: cells[3] });
    }

    // O saldo do cabeçalho é o saldo no momento da exportação: se o período do extrato termina antes
    // dessa data, ele inclui movimentos posteriores ao fim do período que não estão no arquivo e
    // geraria divergência falsa. Só entra na conferência quando o período alcança a exportação.
    if (period) {
      const periodTo = period.to;
      for (let i = balances.length - 1; i >= 0; i--) {
        if (balances[i].current === true && balances[i].dateISO > periodTo) balances.splice(i, 1);
      }
    }

    if (raw.length === 0 && balances.length === 0) {
      throw new StatementParseError("nenhum lançamento ou saldo encontrado no extrato");
    }

    const fingerprints = ordinalFingerprints(
      raw.map((r) => importFingerprint(ctx.accountId, r.date, r.signed, r.description)),
    );
    const rows: ParsedRow[] = raw.map((r, i) => ({
      type: r.signed < 0 ? "expense" : "income",
      amountCents: Math.abs(r.signed),
      date: r.date,
      postedDate: r.postedDate,
      description: r.description,
      fingerprint: fingerprints[i],
    }));

    return { rows, balances, accountRef, period };
  },
};
