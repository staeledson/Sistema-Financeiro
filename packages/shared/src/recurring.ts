import { normalizeDescriptionKey } from "./categorization";
import { addMonths, lastDayOfMonth, daysBetweenISO } from "./dashboard";

export type RecurringInput = { description: string; amountCents: number; date: string; installment?: boolean };
export type RecurringGroup = {
  key: string; label: string; frequency: "monthly" | "weekly"; avgCents: number; intervalDays: number;
  occurrences: number; monthlyEstimateCents: number; lastDate: string;
};

export function detectRecurring(rows: RecurringInput[]): RecurringGroup[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const r of rows) {
    if (r.installment) continue;
    const key = normalizeDescriptionKey(r.description);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const out: RecurringGroup[] = [];
  for (const [key, list] of groups) {
    // Mesma chave e mesma data: uma só ocorrência (soma dos valores).
    const byDate = new Map<string, number>();
    for (const r of list) byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.amountCents);
    const sorted = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, amountCents]) => ({ date, amountCents }));
    if (sorted.length < 3) continue;
    const gaps = sorted.slice(1).map((r, i) => daysBetweenISO(sorted[i].date, r.date));
    const intervalDays = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const avg = sorted.reduce((s, r) => s + r.amountCents, 0) / sorted.length;
    if (avg <= 0 || sorted.some((r) => Math.abs(r.amountCents - avg) / avg > 0.15)) continue;
    const frequency = intervalDays >= 25 && intervalDays <= 35 ? "monthly" : intervalDays >= 6 && intervalDays <= 8 ? "weekly" : null;
    if (!frequency) continue;
    const [minGap, maxGap] = frequency === "monthly" ? [15, 45] : [3, 11];
    if (gaps.some((g) => g < minGap || g > maxGap)) continue;
    // Rótulo: descrição bruta mais frequente; empate fica com a mais recente.
    const counts = new Map<string, { n: number; last: string }>();
    for (const r of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
      const c = counts.get(r.description);
      counts.set(r.description, { n: (c?.n ?? 0) + 1, last: r.date });
    }
    const label = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))[0][0];
    out.push({
      key, label, frequency, avgCents: Math.round(avg), intervalDays: Math.round(intervalDays), occurrences: sorted.length,
      monthlyEstimateCents: frequency === "monthly" ? Math.round(avg) : Math.round((avg * 52) / 12),
      lastDate: sorted[sorted.length - 1].date,
    });
  }
  return out.sort((a, b) => b.monthlyEstimateCents - a.monthlyEstimateCents || a.key.localeCompare(b.key));
}

export type Bill = { name: string; amountCents: number; dueDate: string; recurrence: "once" | "weekly" | "monthly" | "yearly"; active: boolean };

export function billAmountInMonth(bill: Omit<Bill, "name"> & { name?: string }, ym: string): number {
  if (!bill.active) return 0;
  const startYm = bill.dueDate.slice(0, 7);
  if (ym < startYm) return 0;
  switch (bill.recurrence) {
    case "once": return ym === startYm ? bill.amountCents : 0;
    case "monthly": return bill.amountCents;
    case "yearly": return ym.slice(5) === startYm.slice(5) ? bill.amountCents : 0;
    case "weekly": {
      const weekday = new Date(`${bill.dueDate}T00:00:00Z`).getUTCDay();
      let n = 0;
      for (let d = 1; d <= lastDayOfMonth(ym); d++) {
        const iso = `${ym}-${String(d).padStart(2, "0")}`;
        if (iso >= bill.dueDate && new Date(`${iso}T00:00:00Z`).getUTCDay() === weekday) n++;
      }
      return n * bill.amountCents;
    }
  }
}

export type ForecastInput = {
  firstMonth: string;
  months: number;
  history: Array<{ month: string; incomeCents: number; expenseCents: number }>;
  historyInstallmentsAvgCents: number;
  recurring: RecurringGroup[];
  bills: Bill[];
  installments: Array<{ month: string; amountCents: number }>;
  startBalanceCents: number;
};
export type ForecastMonth = {
  month: string; incomeCents: number; variableCents: number; recurringCents: number;
  billsCents: number; installmentsCents: number; expenseCents: number; balanceCents: number;
};

export function forecastCashflow(input: ForecastInput): ForecastMonth[] {
  const n = input.history.length;
  const incomeCents = n ? Math.round(input.history.reduce((s, h) => s + h.incomeCents, 0) / n) : 0;
  const avgExpense = n ? input.history.reduce((s, h) => s + h.expenseCents, 0) / n : 0;
  const recurringCents = input.recurring.reduce((s, g) => s + g.monthlyEstimateCents, 0);
  const variableCents = Math.max(0, Math.round(avgExpense) - recurringCents - input.historyInstallmentsAvgCents);
  const tokens = (text: string) => new Set(text.split(" ").filter(Boolean));
  const subset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t));
  const covered = (name: string) => {
    const k = tokens(normalizeDescriptionKey(name));
    if (!k.size) return false;
    return input.recurring.some((g) => {
      const t = tokens(g.key);
      return t.size > 0 && (subset(k, t) || subset(t, k));
    });
  };
  const bills = input.bills.filter((b) => !covered(b.name));

  let balance = input.startBalanceCents;
  return Array.from({ length: input.months }, (_, i) => {
    const month = addMonths(input.firstMonth, i);
    const billsCents = bills.reduce((s, b) => s + billAmountInMonth(b, month), 0);
    const installmentsCents = input.installments.filter((x) => x.month === month).reduce((s, x) => s + x.amountCents, 0);
    const expenseCents = variableCents + recurringCents + billsCents + installmentsCents;
    balance += incomeCents - expenseCents;
    return { month, incomeCents, variableCents, recurringCents, billsCents, installmentsCents, expenseCents, balanceCents: balance };
  });
}
