/**
 * "YYYY-MM-DD" (ou ISO com hora, de uma coluna `date` da API, sempre à meia-noite UTC) → "DD/MM/AAAA" lendo só os
 * 10 primeiros caracteres. Passar por `new Date()` mostraria o dia anterior em fusos a oeste de UTC (Brasil).
 * Para instantes reais (ex.: `createdAt`), use `Date#toLocaleDateString`.
 */
export function formatDateOnly(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return new Date(iso).toLocaleDateString("pt-BR");
}
