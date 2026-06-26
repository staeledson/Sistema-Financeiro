import { z } from "zod";

export const csvMappingSchema = z.object({
  dateColumn: z.string(),
  amountColumn: z.string(),
  descriptionColumn: z.string().nullish(),
  dateFormat: z.enum(["DD/MM/YYYY", "YYYY-MM-DD", "MM/DD/YYYY"]).default("DD/MM/YYYY"),
  decimalSeparator: z.enum([",", "."]).default(","),
  expenseIsNegative: z.boolean().default(true),
});
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export function parseBrDate(raw: string, fmt: CsvMapping["dateFormat"]): string {
  const s = raw.trim();
  if (fmt === "YYYY-MM-DD") return s;
  const parts = s.split(/[\/\-.]/);
  const [a, b, c] = parts;
  return fmt === "DD/MM/YYYY"
    ? `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`
    : `${c}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
}

export function parseAmountCents(raw: string, decimal: "," | "."): number {
  let s = raw.trim().replace(/\s/g, "");
  if (decimal === ",") {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  return Math.round(parseFloat(s) * 100);
}

export function importFingerprint(
  accountId: string,
  dateISO: string,
  amountCents: number,
  desc?: string | null,
): string {
  const norm = (desc ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${accountId}|${dateISO}|${amountCents}|${norm}`;
}

export function csvRowToTransaction(
  row: Record<string, string>,
  m: CsvMapping,
  accountId: string,
) {
  const signed = parseAmountCents(row[m.amountColumn] ?? "0", m.decimalSeparator);
  const isExpense = m.expenseIsNegative ? signed < 0 : signed > 0;
  const dateISO = parseBrDate(row[m.dateColumn] ?? "", m.dateFormat);
  const description = m.descriptionColumn ? (row[m.descriptionColumn] ?? null) : null;
  const amountCents = Math.abs(signed);
  return {
    type: isExpense ? ("expense" as const) : ("income" as const),
    amountCents,
    date: dateISO,
    accountId,
    description,
    fingerprint: importFingerprint(accountId, dateISO, isExpense ? -amountCents : amountCents, description),
  };
}
