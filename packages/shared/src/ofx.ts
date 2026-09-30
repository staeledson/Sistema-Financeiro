export type OfxTxn = {
  /** Null quando o arquivo não traz FITID para a transação. */
  fitid: string | null;
  dateISO: string;
  amountCents: number;
  memo: string | null;
};

export function parseOfx(text: string): OfxTxn[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string): string | null => {
    const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i"));
    return m ? m[1].trim() : null;
  };
  return blocks.map((b) => {
    const dt = tag(b, "DTPOSTED") ?? "";
    const dateISO = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const amtRaw = (tag(b, "TRNAMT") ?? "0").replace(",", ".");
    const amt = parseFloat(amtRaw);
    return {
      fitid: tag(b, "FITID") || null,
      dateISO,
      amountCents: Math.round(amt * 100),
      memo: tag(b, "MEMO") ?? tag(b, "NAME"),
    };
  });
}
