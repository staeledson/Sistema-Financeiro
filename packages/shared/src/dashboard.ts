import { z } from "zod";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => {
  if (!YMD.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
export function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
export function lastDayOfMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export const dashboardFilterSchema = z
  .object({
    entity: z.enum(["pf", "pj", "all"]).default("all"),
    accountId: z.string().min(1).optional(),
    month: z.string().regex(/^(19|20)\d{2}-(0[1-9]|1[0-2])$/).optional(),
    quarter: z.string().regex(/^(19|20)\d{2}-Q[1-4]$/).optional(),
    year: z.string().regex(/^(19|20)\d{2}$/).optional(),
    from: z.string().refine(isRealDate, "data inválida").optional(),
    to: z.string().refine(isRealDate, "data inválida").optional(),
    asOf: z.string().refine(isRealDate, "data inválida").optional(),
  })
  .superRefine((v, ctx) => {
    const kinds = [v.month, v.quarter, v.year, v.from || v.to].filter(Boolean).length;
    if (kinds > 1) ctx.addIssue({ code: "custom", message: "informe um único tipo de período" });
    if (Boolean(v.from) !== Boolean(v.to)) ctx.addIssue({ code: "custom", message: "from e to devem vir juntos" });
    if (v.from && v.to) {
      if (v.from > v.to) ctx.addIssue({ code: "custom", message: "from deve ser anterior a to" });
      else if (daysBetweenISO(v.from, v.to) > 1100) ctx.addIssue({ code: "custom", message: "intervalo máximo de 1100 dias" });
    }
  });

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;

export type Period = { kind: "month" | "quarter" | "year" | "range"; from: string; to: string; label: string };

function monthSpan(startYm: string, count: number): { from: string; to: string } {
  const endYm = addMonths(startYm, count - 1);
  return { from: `${startYm}-01`, to: `${endYm}-${pad(lastDayOfMonth(endYm))}` };
}

export function resolvePeriod(f: Pick<DashboardFilter, "month" | "quarter" | "year" | "from" | "to">, today: string): Period {
  if (f.from && f.to) return { kind: "range", from: f.from, to: f.to, label: `${f.from} a ${f.to}` };
  if (f.year) return { kind: "year", ...monthSpan(`${f.year}-01`, 12), label: f.year };
  if (f.quarter) {
    const [y, q] = f.quarter.split("-Q").map(Number);
    return { kind: "quarter", ...monthSpan(`${y}-${pad((q - 1) * 3 + 1)}`, 3), label: `${q}º tri ${y}` };
  }
  const ym = f.month ?? today.slice(0, 7);
  const [y, m] = ym.split("-");
  return { kind: "month", ...monthSpan(ym, 1), label: `${m}/${y}` };
}

export function previousPeriod(p: Period): Period {
  if (p.kind === "range") {
    const n = daysBetweenISO(p.from, p.to) + 1;
    const to = addDaysISO(p.from, -1);
    const from = addDaysISO(to, -(n - 1));
    return { kind: "range", from, to, label: `${from} a ${to}` };
  }
  const len = p.kind === "month" ? 1 : p.kind === "quarter" ? 3 : 12;
  const start = addMonths(p.from.slice(0, 7), -len);
  return resolvePeriod(
    p.kind === "month" ? { month: start } : p.kind === "year" ? { year: start.slice(0, 4) } : { quarter: `${start.slice(0, 4)}-Q${Math.floor((Number(start.slice(5)) - 1) / 3) + 1}` },
    p.to,
  );
}

export function periodMonths(p: Period): string[] {
  const out: string[] = [];
  for (let ym = p.from.slice(0, 7); ym <= p.to.slice(0, 7); ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

export function lastMonths(endYm: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(endYm, i - (n - 1)));
}

export type CategoryMonthTotal = { categoryId: string | null; name: string; month: string; totalCents: number };
export type StackedSeries = { key: string; categoryId: string | null; name: string; totalsCents: number[] };

export function stackByMonth(rows: CategoryMonthTotal[], months: string[], topN = 6): { months: string[]; series: StackedSeries[] } {
  const byCat = new Map<string, { categoryId: string | null; name: string; byMonth: Map<string, number>; total: number }>();
  for (const r of rows) {
    const key = r.categoryId ?? "__none";
    const cur = byCat.get(key) ?? { categoryId: r.categoryId, name: r.name, byMonth: new Map(), total: 0 };
    cur.byMonth.set(r.month, (cur.byMonth.get(r.month) ?? 0) + r.totalCents);
    cur.total += r.totalCents;
    byCat.set(key, cur);
  }
  const ranked = [...byCat.entries()].sort((a, b) => b[1].total - a[1].total || a[1].name.localeCompare(b[1].name));
  const series: StackedSeries[] = ranked.slice(0, topN).map(([key, c]) => ({
    key, categoryId: c.categoryId, name: c.name, totalsCents: months.map((m) => c.byMonth.get(m) ?? 0),
  }));
  const rest = ranked.slice(topN);
  if (rest.length) {
    series.push({
      key: "__others", categoryId: null, name: "Outras",
      totalsCents: months.map((m) => rest.reduce((s, [, c]) => s + (c.byMonth.get(m) ?? 0), 0)),
    });
  }
  return { months, series };
}

export function pctChange(currentCents: number, previousCents: number): number | null {
  return previousCents > 0 ? Math.round((currentCents / previousCents - 1) * 100) : null;
}

export function biggestMover(
  rows: Array<{ name: string; currentCents: number; previousCents: number }>,
  minPct = 10,
): string | null {
  let best: { name: string; pct: number; delta: number } | null = null;
  for (const r of rows) {
    const pct = pctChange(r.currentCents, r.previousCents);
    if (pct === null || Math.abs(pct) < minPct) continue;
    const delta = Math.abs(r.currentCents - r.previousCents);
    if (!best || delta > best.delta) best = { name: r.name, pct, delta };
  }
  return best ? `${best.name} ${best.pct > 0 ? "subiu" : "caiu"} ${Math.abs(best.pct)}% vs. período anterior` : null;
}
