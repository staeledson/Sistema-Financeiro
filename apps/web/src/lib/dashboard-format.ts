export interface BreakdownItem {
  categoryId: string | null;
  name: string;
  totalCents: number;
}

export interface BreakdownRow {
  name: string;
  amountCents: number;
  pct: number;
}

export function sortBreakdown(items: BreakdownItem[]): BreakdownRow[] {
  const total = items.reduce((s, i) => s + i.totalCents, 0);
  return [...items]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((i) => ({
      name: i.name || "Sem categoria",
      amountCents: i.totalCents,
      pct: total > 0 ? Math.round((i.totalCents / total) * 100) : 0,
    }));
}
