import { ordinalFingerprints } from "../import";
import { parseBrlCents, toISODate } from "./text";
import {
  StatementParseError,
  type BalancePoint,
  type DetectResult,
  type ParsedRow,
  type ParsedStatement,
  type StatementParser,
} from "./types";

/**
 * Extrato de conta do Mercado Pago (PDF, "EXTRATO DE CONTA"), no texto do pdf-parse. Cada movimento é
 * `dd-mm-aaaa descrição id R$ valor R$ saldo`, mas a descrição pode quebrar em várias linhas (e a data pode
 * ficar sozinha na linha): o registro só termina na linha que fecha com `<id> R$ <valor> R$ <saldo>`.
 *
 * Mensagens de erro citam só o NÚMERO do registro ou texto fixo: o extrato é dado pessoal e a mensagem
 * pode chegar a logs e respostas da API.
 */

const AMOUNT = String.raw`-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}`;
const DATE_START = /^(\d{2})-(\d{2})-(\d{4})(?:\s+(.*))?$/;
const CLOSING = new RegExp(String.raw`^(.*?)\s*(\d{9,})\s+R\$\s*(${AMOUNT})\s+R\$\s*(${AMOUNT})$`);
// em páginas de coluna dupla o pdf-parse repete o cabeçalho na mesma linha, separado por tabulação
const COLUMN_HEADER = /^(?:Data\s+Descri[cç][aã]o\s+ID da opera[cç][aã]o\s+Valor\s+Saldo\s*)+$/;
const PAGE_MARK = /^(\d{1,4})\/(\d{1,4})$/;
const PAGE_FOOTER = /^--\s*\d+\s+of\s+\d+\s*--$/;
const INITIAL = new RegExp(String.raw`Saldo inicial:\s*R\$\s*(${AMOUNT})`);
const INCOMES = new RegExp(String.raw`Entradas:\s*R\$\s*(${AMOUNT})`);
const OUTGOINGS = new RegExp(String.raw`Sa[ií]das:\s*R\$\s*(${AMOUNT})`);
const FINAL = new RegExp(String.raw`^Saldo final:\s*R\$\s*(${AMOUNT})\s*$`);
const PERIOD = /De\s+(\d{2})-(\d{2})-(\d{4})\s+al\s+(\d{2})-(\d{2})-(\d{4})/;
const ACCOUNT = /(\d+)\s*Ag[eê]ncia:/;
const FOOTER_START = /^Data de gera[cç][aã]o:/;
const FOOTER_END = /\s\d{1,4}\/\d{1,4}$/;
const COLUMN_HEADER_ANYWHERE = /Data\s+Descri[cç][aã]o\s+ID da opera[cç][aã]o\s+Valor\s+Saldo/;

/** "R$ -17,00" já sem o prefixo: "-17,00" → -1700 (o sinal vem antes do valor, depois do R$). */
function cents(amount: string): number | null {
  const neg = amount.startsWith("-");
  return parseBrlCents(`${neg ? "-" : ""}R$ ${neg ? amount.slice(1) : amount}`);
}

function normalize(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim());
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

interface RawRecord {
  date: string;
  opId: string;
  signed: number;
  balance: number;
  description: string;
}

export const mercadoPagoStatementParser: StatementParser = {
  id: "mercado_pago",

  detect(text: string): DetectResult | null {
    const t = text.normalize("NFC");
    const ok =
      /EXTRATO DE CONTA/.test(t) &&
      /DETALHE DOS MOVIMENTOS/.test(t) &&
      COLUMN_HEADER_ANYWHERE.test(t) &&
      /Saldo inicial:/.test(t) &&
      /Saldo final:/.test(t);
    if (!ok) return null;
    return {
      institution: "mercado_pago",
      kind: "statement",
      format: "pdf_statement",
      accountRef: t.match(ACCOUNT)?.[1] ?? null,
      confidence: 0.95,
    };
  },

  parse(text: string, ctx: { accountId: string }): ParsedStatement {
    const lines = normalize(text);
    const whole = lines.join("\n");

    const periodMatch = whole.match(PERIOD);
    const from = periodMatch ? toISODate(Number(periodMatch[3]), Number(periodMatch[2]), Number(periodMatch[1])) : null;
    const to = periodMatch ? toISODate(Number(periodMatch[6]), Number(periodMatch[5]), Number(periodMatch[4])) : null;
    if (!from || !to) throw new StatementParseError("período do extrato ausente ou inválido");

    const initial = whole.match(INITIAL) ? cents(whole.match(INITIAL)![1]) : null;
    const declaredIn = whole.match(INCOMES) ? cents(whole.match(INCOMES)![1]) : null;
    const declaredOut = whole.match(OUTGOINGS) ? cents(whole.match(OUTGOINGS)![1]) : null;
    if (initial === null || declaredIn === null || declaredOut === null) {
      throw new StatementParseError("saldo inicial ou totais do cabeçalho ausentes");
    }
    const accountRef = whole.match(ACCOUNT)?.[1] ?? null;

    // número total de páginas, para não confundir a marca "n/N" com uma linha de descrição
    const totalPages = lines.map((l) => l.match(PAGE_MARK)).find((m) => m !== null)?.[2] ?? null;

    const raw: RawRecord[] = [];
    let declaredFinal: number | null = null;
    let inBody = false;
    let open: { date: string; parts: string[] } | null = null;
    // Linhas de descrição no fim de uma página cuja data só vem no topo da seguinte (registro partido pela quebra de página).
    let orphan: string[] = [];
    let pageBreakSinceOrphan = false;
    // Rodapé legal ("Data de geração: …" + aviso) que o pdf-parse solta no topo da página: acaba na linha que termina com a marca "n/N".
    let inFooter = false;

    for (const line of lines) {
      if (!inBody) {
        if (line === "DETALHE DOS MOVIMENTOS") inBody = true;
        continue;
      }
      if (line === "") continue;
      const fin = line.match(FINAL);
      if (fin) {
        declaredFinal = cents(fin[1]);
        continue;
      }
      if (!inFooter && FOOTER_START.test(line)) inFooter = true;
      if (inFooter) {
        if (DATE_START.test(line) || COLUMN_HEADER.test(line)) inFooter = false;
        else {
          if (FOOTER_END.test(line)) inFooter = false;
          if (orphan.length > 0) pageBreakSinceOrphan = true;
          continue;
        }
      }
      const page = line.match(PAGE_MARK);
      const furniture =
        COLUMN_HEADER.test(line) ||
        PAGE_FOOTER.test(line) ||
        (page !== null && page[2] === totalPages && Number(page[1]) <= Number(page[2]));
      if (furniture) {
        if (orphan.length > 0) pageBreakSinceOrphan = true;
        continue;
      }

      let content = line;
      const start = line.match(DATE_START);
      if (start) {
        if (open) throw new StatementParseError(`registro ${raw.length + 1} incompleto`);
        const date = toISODate(Number(start[3]), Number(start[2]), Number(start[1]));
        if (!date) throw new StatementParseError(`registro ${raw.length + 1}: data inválida`);
        if (orphan.length > 0 && !pageBreakSinceOrphan) {
          throw new StatementParseError(`linha fora de um registro (após o registro ${raw.length})`);
        }
        open = { date, parts: orphan };
        orphan = [];
        pageBreakSinceOrphan = false;
        content = start[4] ?? "";
      } else if (!open) {
        orphan.push(line);
        continue;
      }

      const closing = content.match(CLOSING);
      if (closing) {
        const [, head, opId, value, balance] = closing;
        if (head) open!.parts.push(head);
        const signed = cents(value);
        const bal = cents(balance);
        if (signed === null || bal === null) throw new StatementParseError(`registro ${raw.length + 1}: valor inválido`);
        raw.push({
          date: open!.date,
          opId,
          signed,
          balance: bal,
          description: open!.parts.join(" ").replace(/\s+/g, " ").trim(),
        });
        open = null;
      } else if (content) {
        open!.parts.push(content);
      }
    }

    if (open || orphan.length > 0) throw new StatementParseError(`registro ${raw.length + 1} incompleto`);
    if (raw.length === 0) throw new StatementParseError("nenhum lançamento encontrado no extrato");

    // Totais do cabeçalho e continuidade do saldo corrente, na ordem do arquivo.
    let running = initial;
    let sumIn = 0;
    let sumOut = 0;
    raw.forEach((r, i) => {
      if (r.date < from || r.date > to) throw new StatementParseError(`registro ${i + 1}: data fora do período`);
      if (running + r.signed !== r.balance) throw new StatementParseError(`saldo do registro ${i + 1} não confere`);
      running = r.balance;
      if (r.signed > 0) sumIn += r.signed;
      else sumOut += r.signed;
    });
    if (sumIn !== declaredIn) throw new StatementParseError("total de entradas não confere com o cabeçalho");
    if (sumOut !== declaredOut) throw new StatementParseError("total de saídas não confere com o cabeçalho");
    if (declaredFinal !== null && declaredFinal !== running) {
      throw new StatementParseError("saldo final não confere com o último registro");
    }

    // Pontos de saldo: âncora (saldo inicial no dia anterior ao período) e o saldo após o último registro de cada data.
    const balances: BalancePoint[] = [{ dateISO: dayBefore(from), balanceCents: initial }];
    const lastOfDay = new Map<string, number>();
    for (const r of raw) lastOfDay.set(r.date, r.balance);
    for (const [dateISO, balanceCents] of [...lastOfDay].sort((a, b) => a[0].localeCompare(b[0]))) {
      balances.push({ dateISO, balanceCents });
    }

    // Valor zero não vira linha (como no parser do C6), mas já passou na continuidade do saldo.
    const kept = raw.filter((r) => r.signed !== 0);
    const fingerprints = ordinalFingerprints(kept.map((r) => `mp:${ctx.accountId}:${r.opId}:${r.signed}`));
    const rows: ParsedRow[] = kept.map((r, i) => ({
      type: r.signed < 0 ? "expense" : "income",
      amountCents: Math.abs(r.signed),
      date: r.date,
      postedDate: null,
      description: r.description || null,
      fingerprint: fingerprints[i],
    }));

    return { rows, balances, accountRef, period: { from, to } };
  },
};
