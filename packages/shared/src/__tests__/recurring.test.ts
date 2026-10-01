import { describe, it, expect } from "vitest";
import { detectRecurring, billAmountInMonth, forecastCashflow } from "../recurring";

const monthly = (desc: string, amounts: number[], start = "2026-01-10") =>
  amounts.map((amountCents, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return { description: desc, amountCents, date: d.toISOString().slice(0, 10) };
  });

describe("detectRecurring", () => {
  it("assinatura mensal com dígitos variando na descrição", () => {
    const rows = [
      { description: "NETFLIX 01/2026", amountCents: 5590, date: "2026-01-10" },
      { description: "NETFLIX 02/2026", amountCents: 5590, date: "2026-02-10" },
      { description: "NETFLIX 03/2026", amountCents: 5590, date: "2026-03-10" },
      { description: "NETFLIX 04/2026", amountCents: 5590, date: "2026-04-10" },
    ];
    const [g] = detectRecurring(rows);
    expect(g).toMatchObject({ key: "netflix", frequency: "monthly", avgCents: 5590, occurrences: 4, monthlyEstimateCents: 5590, lastDate: "2026-04-10" });
    expect(g.intervalDays).toBe(30);
  });
  it("rejeita menos de 3 ocorrências, desvio de valor acima de 15% e intervalos irregulares", () => {
    expect(detectRecurring(monthly("Spotify", [1990, 1990]))).toEqual([]);
    expect(detectRecurring(monthly("Luz", [10000, 10000, 13000]))).toEqual([]); // 13000 desvia 18,2% da média (11000)
    expect(detectRecurring([
      { description: "Padaria", amountCents: 1000, date: "2026-01-02" },
      { description: "Padaria", amountCents: 1000, date: "2026-01-03" },
      { description: "Padaria", amountCents: 1000, date: "2026-02-20" },
    ])).toEqual([]);
  });
  it("semanal estima o total mensal e parcelas ficam de fora", () => {
    const weekly = ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"].map((date) => ({ description: "Feira", amountCents: 3000, date }));
    expect(detectRecurring(weekly)[0]).toMatchObject({ frequency: "weekly", monthlyEstimateCents: Math.round((3000 * 52) / 12) });
    expect(detectRecurring(monthly("Geladeira 03/10", [20000, 20000, 20000]).map((r) => ({ ...r, installment: true })))).toEqual([]);
  });
  it("ordena pelo maior total mensal estimado", () => {
    const out = detectRecurring([...monthly("Spotify", [1990, 1990, 1990]), ...monthly("Aluguel", [200000, 200000, 200000])]);
    expect(out.map((g) => g.key)).toEqual(["aluguel", "spotify"]);
  });
});

describe("billAmountInMonth", () => {
  const base = { amountCents: 1000, dueDate: "2026-03-05", active: true };
  it("única, mensal, anual e semanal", () => {
    expect(billAmountInMonth({ ...base, recurrence: "once" }, "2026-03")).toBe(1000);
    expect(billAmountInMonth({ ...base, recurrence: "once" }, "2026-04")).toBe(0);
    expect(billAmountInMonth({ ...base, recurrence: "monthly" }, "2026-02")).toBe(0);
    expect(billAmountInMonth({ ...base, recurrence: "monthly" }, "2026-07")).toBe(1000);
    expect(billAmountInMonth({ ...base, recurrence: "yearly" }, "2027-03")).toBe(1000);
    expect(billAmountInMonth({ ...base, recurrence: "yearly" }, "2027-04")).toBe(0);
    // 2026-03-05 é quinta: quintas de abril/2026 = 2, 9, 16, 23, 30
    expect(billAmountInMonth({ ...base, recurrence: "weekly" }, "2026-04")).toBe(5000);
    expect(billAmountInMonth({ ...base, active: false, recurrence: "monthly" }, "2026-07")).toBe(0);
  });
});

describe("forecastCashflow", () => {
  const history = ["2026-03", "2026-04", "2026-05"].map((month) => ({ month, incomeCents: 1_000_000, expenseCents: 600_000 }));
  const recurring = [{ key: "netflix", label: "Netflix", frequency: "monthly" as const, avgCents: 100_000, intervalDays: 30, occurrences: 6, monthlyEstimateCents: 100_000, lastDate: "2026-05-10" }];
  it("soma variável, recorrentes, contas e parcelas e acumula o saldo", () => {
    const out = forecastCashflow({
      firstMonth: "2026-07", months: 2, history, historyInstallmentsAvgCents: 50_000, recurring,
      bills: [{ name: "Aluguel", amountCents: 200_000, dueDate: "2026-07-05", recurrence: "monthly", active: true }],
      installments: [{ month: "2026-07", amountCents: 80_000 }],
      startBalanceCents: 100_000,
    });
    expect(out[0]).toEqual({
      month: "2026-07", incomeCents: 1_000_000, variableCents: 450_000, recurringCents: 100_000,
      billsCents: 200_000, installmentsCents: 80_000, expenseCents: 830_000, balanceCents: 270_000,
    });
    expect(out[1]).toMatchObject({ month: "2026-08", installmentsCents: 0, expenseCents: 750_000, balanceCents: 520_000 });
  });
  it("conta que casa com uma recorrente detectada não entra em dobro; sem histórico tudo é zero", () => {
    const out = forecastCashflow({
      firstMonth: "2026-07", months: 1, history, historyInstallmentsAvgCents: 0, recurring,
      bills: [{ name: "Netflix", amountCents: 5590, dueDate: "2026-07-10", recurrence: "monthly", active: true }],
      installments: [], startBalanceCents: 0,
    });
    expect(out[0].billsCents).toBe(0);
    const empty = forecastCashflow({ firstMonth: "2026-07", months: 1, history: [], historyInstallmentsAvgCents: 0, recurring: [], bills: [], installments: [], startBalanceCents: 5 });
    expect(empty[0]).toMatchObject({ incomeCents: 0, expenseCents: 0, balanceCents: 5 });
  });
});
