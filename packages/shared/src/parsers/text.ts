const MONTHS_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

export function monthFromName(name: string): number | null {
  return MONTHS_PT[name.trim().toLowerCase()] ?? null;
}

/** "R$ 1.234,56" → 123456; "-R$ 500,00" → -50000; o que não for valor → null. */
export function parseBrlCents(raw: string): number | null {
  const m = raw.trim().match(/^(-?)\s*R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!m) return null;
  const cents = Number(m[2].replace(/\./g, "") + m[3]);
  return m[1] ? -cents : cents;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD se a data existe no calendário; senão null. */
export function toISODate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Extratos trazem só dd/mm. O ano é o que deixa a data mais perto do meio do período do bloco
 * (cobre lançamento de 30/12 listado no bloco de janeiro e contábil de 02/01 listado no de dezembro).
 */
export function inferYearISO(day: number, month: number, fromISO: string, toISO: string): string | null {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  const mid = (from + to) / 2;
  const fromY = new Date(from).getUTCFullYear();
  const toY = new Date(to).getUTCFullYear();
  let best: { iso: string; dist: number } | null = null;
  for (let y = fromY - 1; y <= toY + 1; y++) {
    const iso = toISODate(y, month, day);
    if (!iso) continue;
    const dist = Math.abs(Date.parse(`${iso}T00:00:00Z`) - mid);
    if (!best || dist < best.dist) best = { iso, dist };
  }
  return best?.iso ?? null;
}

/** "5", "setembro", "2026" → "2026-09-05". */
export function parsePtLongDate(day: string, monthName: string, year: string): string | null {
  const month = monthFromName(monthName);
  return month ? toISODate(Number(year), month, Number(day)) : null;
}

/** Colunas de uma linha de extrato: por tabulação (pdf-parse) ou, sem tabulação, por 2+ espaços (pdftotext -layout). */
export function splitCells(line: string): string[] {
  const t = line.trim();
  return t.includes("\t") ? t.split(/\s*\t\s*/) : t.split(/\s{2,}/);
}
