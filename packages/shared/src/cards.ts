import { addDaysISO, addMonths, lastDayOfMonth } from "./dashboard";

export type InvoiceCycle = { ym: string; start: string; closing: string; due: string };

const pad = (n: number) => String(n).padStart(2, "0");
const clampDay = (ym: string, day: number) => `${ym}-${pad(Math.min(day, lastDayOfMonth(ym)))}`;

/** Ciclo que FECHA no mês `ym`. */
export function cycleClosingIn(ym: string, closingDay: number, dueDay: number): InvoiceCycle {
  const closing = clampDay(ym, closingDay);
  const start = addDaysISO(clampDay(addMonths(ym, -1), closingDay), 1);
  const dueYm = dueDay > closingDay ? ym : addMonths(ym, 1);
  return { ym, start, closing, due: clampDay(dueYm, dueDay) };
}

/** Ciclo (fatura) em que uma compra feita em `date` cai. */
export function cycleOf(date: string, closingDay: number, dueDay: number): InvoiceCycle {
  const ym = date.slice(0, 7);
  const same = cycleClosingIn(ym, closingDay, dueDay);
  return date <= same.closing ? same : cycleClosingIn(addMonths(ym, 1), closingDay, dueDay);
}

export function recentCycles(today: string, closingDay: number, dueDay: number, closedCount: number) {
  const open = cycleOf(today, closingDay, dueDay);
  const closed = Array.from({ length: closedCount }, (_, i) => cycleClosingIn(addMonths(open.ym, i - closedCount), closingDay, dueDay));
  return { open, closed };
}

const INSTALLMENT = /(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/;

/** "n/m" na descrição de lançamento de cartão; ignora datas, mês/ano e valores incoerentes. */
export function parseInstallment(text: string | null | undefined): { current: number; total: number } | null {
  const m = INSTALLMENT.exec(text ?? "");
  if (!m) return null;
  const current = Number(m[1]);
  const total = Number(m[2]);
  return total >= 2 && total <= 60 && current >= 1 && current <= total ? { current, total } : null;
}
