export type OfxTxn = {
  /** Null quando o arquivo não traz FITID para a transação. */
  fitid: string | null;
  dateISO: string;
  amountCents: number;
  memo: string | null;
};

/** "1.234,56" (BR) e "1,234.56" (US) viram número; sem vírgula o ponto é decimal ("1234.56"). */
export function normalizeAmount(raw: string): string {
  if (!raw.includes(",")) return raw;
  if (raw.lastIndexOf(".") > raw.lastIndexOf(",")) return raw.replace(/,/g, "");
  return raw.replace(/\./g, "").replace(",", ".");
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** OFX em SGML/XML escapa `&`, `<`, `>` e aspas; bancos também mandam `&#39;`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

export function parseOfx(text: string): OfxTxn[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string): string | null => {
    const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i"));
    return m ? m[1].trim() : null;
  };
  return blocks.map((b) => {
    const dt = tag(b, "DTPOSTED") ?? "";
    const dateISO = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    // TRNAMT ausente vira NaN (e não 0): o parser de extrato rejeita a transação em vez de importar valor zero
    const trnAmt = tag(b, "TRNAMT");
    const amtRaw = trnAmt ? normalizeAmount(trnAmt) : trnAmt;
    const amt = amtRaw ? parseFloat(amtRaw) : NaN;
    return {
      fitid: tag(b, "FITID") || null,
      dateISO,
      amountCents: Math.round(amt * 100),
      memo: decodeEntities(tag(b, "MEMO") ?? tag(b, "NAME") ?? "") || null,
    };
  });
}
