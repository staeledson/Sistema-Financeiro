import { describe, it, expect } from "vitest";
import {
  dashboardFilterSchema, resolvePeriod, previousPeriod, periodMonths, lastMonths,
  addMonths, addDaysISO, daysBetweenISO, lastDayOfMonth, stackByMonth, pctChange, biggestMover,
} from "../dashboard";

describe("dashboardFilterSchema", () => {
  it("aceita só um tipo de período e entity padrão all", () => {
    expect(dashboardFilterSchema.parse({}).entity).toBe("all");
    expect(dashboardFilterSchema.parse({ month: "2026-06", entity: "pj" })).toMatchObject({ month: "2026-06", entity: "pj" });
  });
  it("rejeita períodos misturados, from sem to, datas falsas e intervalos invertidos ou enormes", () => {
    expect(() => dashboardFilterSchema.parse({ month: "2026-06", year: "2026" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2026-01-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2026-02-30", to: "2026-03-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2026-03-02", to: "2026-03-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2020-01-01", to: "2026-03-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ month: "2026-13" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ entity: "xx" })).toThrow();
  });
});

describe("datas ISO", () => {
  it("addMonths atravessa o ano e lastDayOfMonth respeita bissexto", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(lastDayOfMonth("2024-02")).toBe(29);
    expect(lastDayOfMonth("2026-02")).toBe(28);
    expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetweenISO("2026-03-01", "2026-03-10")).toBe(9);
  });
});

describe("resolvePeriod / previousPeriod", () => {
  it("usa o mês de hoje por padrão", () => {
    expect(resolvePeriod({}, "2026-06-20")).toMatchObject({ kind: "month", from: "2026-06-01", to: "2026-06-30" });
  });
  it("trimestre, ano e intervalo", () => {
    expect(resolvePeriod({ quarter: "2026-Q2" }, "2026-06-20")).toMatchObject({ kind: "quarter", from: "2026-04-01", to: "2026-06-30" });
    expect(resolvePeriod({ year: "2026" }, "2026-06-20")).toMatchObject({ kind: "year", from: "2026-01-01", to: "2026-12-31" });
    expect(resolvePeriod({ from: "2026-03-10", to: "2026-03-19" }, "2026-06-20")).toMatchObject({ kind: "range", from: "2026-03-10", to: "2026-03-19" });
  });
  it("período anterior de mesma duração", () => {
    expect(previousPeriod(resolvePeriod({ month: "2026-01" }, "2026-06-20"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(previousPeriod(resolvePeriod({ quarter: "2026-Q1" }, "2026-06-20"))).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
    expect(previousPeriod(resolvePeriod({ year: "2026" }, "2026-06-20"))).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(previousPeriod(resolvePeriod({ from: "2026-03-10", to: "2026-03-19" }, "2026-06-20"))).toMatchObject({ from: "2026-02-28", to: "2026-03-09" });
  });
  it("meses tocados e janela dos últimos n meses", () => {
    expect(periodMonths(resolvePeriod({ quarter: "2026-Q4" }, "2026-06-20"))).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(periodMonths(resolvePeriod({ from: "2026-01-31", to: "2026-02-01" }, "2026-06-20"))).toEqual(["2026-01", "2026-02"]);
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("stackByMonth", () => {
  const rows = [
    { categoryId: "a", name: "Mercado", month: "2026-05", totalCents: 100 },
    { categoryId: "a", name: "Mercado", month: "2026-06", totalCents: 300 },
    { categoryId: "b", name: "Lazer", month: "2026-06", totalCents: 200 },
    { categoryId: "c", name: "Café", month: "2026-06", totalCents: 50 },
    { categoryId: null, name: "Sem categoria", month: "2026-05", totalCents: 10 },
  ];
  it("mantém as top N e agrega o resto em Outras, alinhado aos meses", () => {
    const out = stackByMonth(rows, ["2026-05", "2026-06"], 2);
    expect(out.series.map((s) => s.name)).toEqual(["Mercado", "Lazer", "Outras"]);
    expect(out.series[0].totalsCents).toEqual([100, 300]);
    expect(out.series[1].totalsCents).toEqual([0, 200]);
    expect(out.series[2]).toMatchObject({ key: "__others", totalsCents: [10, 50] });
  });
  it("sem excedente não cria Outras; 'Sem categoria' é uma série normal", () => {
    const out = stackByMonth(rows, ["2026-05", "2026-06"], 6);
    expect(out.series.map((s) => s.name)).toEqual(["Mercado", "Lazer", "Café", "Sem categoria"]);
    expect(out.series.some((s) => s.key === "__others")).toBe(false);
  });
});

describe("pctChange / biggestMover", () => {
  it("pctChange é nulo sem base e arredonda", () => {
    expect(pctChange(118, 100)).toBe(18);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
  });
  it("biggestMover escolhe a maior variação absoluta em centavos acima do mínimo", () => {
    const rows = [
      { name: "Supermercado", currentCents: 11800, previousCents: 10000 },
      { name: "Lazer", currentCents: 5000, previousCents: 4900 },
      { name: "Transporte", currentCents: 1000, previousCents: 3000 },
      { name: "Novo", currentCents: 9000, previousCents: 0 },
    ];
    expect(biggestMover(rows)).toBe("Transporte caiu 67% vs. período anterior");
    expect(biggestMover([rows[1]])).toBeNull();
    expect(biggestMover([])).toBeNull();
  });
});
