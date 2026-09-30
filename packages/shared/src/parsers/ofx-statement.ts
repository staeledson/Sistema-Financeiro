import type { Institution } from "../enums";
import { importFingerprint, ordinalFingerprints } from "../import";
import { parseOfx } from "../ofx";
import {
  StatementParseError,
  type BalancePoint,
  type DetectResult,
  type ParsedRow,
  type ParsedStatement,
  type StatementParser,
} from "./types";

/** Códigos COMPE dos bancos que o sistema conhece. */
const BANK_BY_ID: Record<string, Institution> = {
  "001": "bb",
  "077": "inter",
  "336": "c6",
  "323": "mercado_pago",
};

const tagValue = (text: string, tag: string): string | null =>
  text.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, "i"))?.[1].trim() ?? null;

function institutionOf(text: string): Institution {
  const id = tagValue(text, "BANKID");
  if (!id) return "other";
  return BANK_BY_ID[id.padStart(3, "0").slice(-3)] ?? "other";
}

export const ofxStatementParser: StatementParser = {
  id: "ofx",

  detect(text: string): DetectResult | null {
    if (!/<OFX>/i.test(text) && !/^\s*OFXHEADER:/i.test(text)) return null;
    const card = /<CCACCTFROM>/i.test(text);
    return {
      institution: institutionOf(text),
      kind: card ? "card_invoice" : "statement",
      format: "ofx",
      accountRef: tagValue(text, "ACCTID"),
      confidence: 0.95,
    };
  },

  parse(text: string, ctx: { accountId: string }): ParsedStatement {
    const txns = parseOfx(text);
    if (txns.length === 0) throw new StatementParseError("nenhuma transação encontrada no OFX");

    const base = txns.map((t) =>
      t.fitid ? null : importFingerprint(ctx.accountId, t.dateISO, t.amountCents, t.memo),
    );
    const ordinals = ordinalFingerprints(base.filter((k): k is string => k !== null));
    let next = 0;

    const rows: ParsedRow[] = txns.map((t, i) => ({
      type: t.amountCents < 0 ? "expense" : "income",
      amountCents: Math.abs(t.amountCents),
      date: t.dateISO,
      postedDate: null,
      description: t.memo,
      fingerprint: base[i] === null ? `ofx:${ctx.accountId}:${t.fitid}` : ordinals[next++],
    }));

    const balances: BalancePoint[] = [];
    const ledger = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>\s*([^<\r\n]+)[\s\S]*?<DTASOF>\s*(\d{8})/i);
    if (ledger) {
      const cents = Math.round(parseFloat(ledger[1].replace(",", ".")) * 100);
      const d = ledger[2];
      if (!Number.isNaN(cents)) balances.push({ dateISO: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, balanceCents: cents });
    }

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      balances,
      accountRef: tagValue(text, "ACCTID"),
      period: { from: dates[0], to: dates[dates.length - 1] },
    };
  },
};
