export type OfxTxn = {
  fitid: string;
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
    const fitid = tag(b, "FITID") ?? `${dateISO}-${amt}`;
    return {
      fitid,
      dateISO,
      amountCents: Math.round(amt * 100),
      memo: tag(b, "MEMO") ?? tag(b, "NAME"),
    };
  });
}
