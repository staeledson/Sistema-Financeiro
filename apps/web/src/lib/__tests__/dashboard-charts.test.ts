import { describe, expect, it } from "vitest";
import {
  budgetBars, cardDailyLine, cashflowBars, forecastLine, installmentsBars, monthLabel, spendingPie, spendingStack,
} from "../dashboard-charts";
import { themeColors } from "../theme-colors";
import { formatBRL } from "../money";

const colors = themeColors();
type Opt = Record<string, any>;
const series = (o: unknown) => (o as Opt).series as Opt[];

describe("spendingPie", () => {
  const cats = [
    { categoryId: "c1", name: "Mercado", totalCents: 15000, previousCents: 6000, pct: 33, count: 2 },
    { categoryId: "__none", name: "Sem categoria", totalCents: 30000, previousCents: 0, pct: 67, count: 1 },
  ];

  it("uma fatia por categoria, em reais, com cores do tema", () => {
    const s = series(spendingPie(cats, colors));
    expect(s).toHaveLength(1);
    expect(s[0].type).toBe("pie");
    expect(s[0].data.map((d: Opt) => [d.name, d.value])).toEqual([["Mercado", 150], ["Sem categoria", 300]]);
    const themeValues = Object.values(colors);
    for (const d of s[0].data) expect(themeValues).toContain(d.itemStyle.color);
  });

  it("tooltip formata em BRL", () => {
    const o = spendingPie(cats, colors) as Opt;
    expect(o.tooltip.valueFormatter(150)).toBe(formatBRL(15000));
  });
});

describe("spendingStack", () => {
  const byMonth = {
    months: ["2026-05", "2026-06"],
    series: [
      { key: "c1", categoryId: "c1", name: "Mercado", totalsCents: [6000, 15000] },
      { key: "c2", categoryId: "c2", name: "Software", totalsCents: [30000, 30000] },
    ],
  };

  it("uma série de barras empilhadas por série da API e eixo com os meses", () => {
    const o = spendingStack(byMonth, colors) as Opt;
    expect(o.xAxis.data).toEqual(["2026-05", "2026-06"]);
    expect(o.series).toHaveLength(2);
    for (const s of o.series) {
      expect(s.type).toBe("bar");
      expect(s.stack).toBe("total");
    }
    expect(o.series[0].data).toEqual([60, 150]);
    expect(o.series[1].name).toBe("Software");
  });

  it("rótulo do mês curto", () => {
    expect(monthLabel("2026-06")).toBe("06/26");
  });
});

describe("budgetBars", () => {
  it("só a barra acima de 100% usa a cor de perigo", () => {
    const o = budgetBars(
      [
        { categoryId: "a", name: "Lazer", limitCents: 10000, spentCents: 15000, pct: 150 },
        { categoryId: "b", name: "Mercado", limitCents: 20000, spentCents: 15000, pct: 75 },
        { categoryId: "c", name: "Exato", limitCents: 10000, spentCents: 10000, pct: 100 },
      ],
      colors,
    ) as Opt;
    const data = o.series[0].data as Opt[];
    expect(data[0].itemStyle.color).toBe(colors.danger);
    expect(data[1].itemStyle.color).toBe(colors.accent);
    expect(data[2].itemStyle.color).toBe(colors.accent);
    expect(o.yAxis.data).toEqual(["Lazer", "Mercado", "Exato"]);
    expect(o.xAxis.max).toBe(150);
  });
});

describe("cardDailyLine", () => {
  it("duas séries; a atual para nos dias sem dado (null)", () => {
    const o = cardDailyLine(
      [
        { day: 1, currentCents: 1000, avgPreviousCents: 500 },
        { day: 2, currentCents: 2500, avgPreviousCents: 900 },
        { day: 3, currentCents: null, avgPreviousCents: 1500 },
      ],
      colors,
    ) as Opt;
    expect(o.series).toHaveLength(2);
    expect(o.series[0].data).toEqual([10, 25, null]);
    expect(o.series[1].data).toEqual([5, 9, 15]);
    expect(o.series[1].lineStyle.type).toBe("dashed");
    expect(o.xAxis.data).toEqual([1, 2, 3]);
  });
});

describe("installmentsBars", () => {
  it("uma barra por mês em reais", () => {
    const o = installmentsBars([{ month: "2026-07", amountCents: 12345, count: 2 }], colors) as Opt;
    expect(o.series[0].data).toEqual([123.45]);
    expect(o.xAxis.data).toEqual(["2026-07"]);
  });
});

describe("cashflowBars", () => {
  it("duas barras (receita, despesa) e uma linha de saldo no eixo secundário", () => {
    const o = cashflowBars(
      [
        { month: "2026-05", incomeCents: 100000, expenseCents: 40000, transfersNetCents: 0, balanceCents: 300000 },
        { month: "2026-06", incomeCents: 120000, expenseCents: 50000, transfersNetCents: 0, balanceCents: 370000 },
      ],
      colors,
    ) as Opt;
    expect(o.series.map((s: Opt) => s.type)).toEqual(["bar", "bar", "line"]);
    expect(o.series[0].data).toEqual([1000, 1200]);
    expect(o.series[1].data).toEqual([400, 500]);
    expect(o.series[2].data).toEqual([3000, 3700]);
    expect(o.series[2].yAxisIndex).toBe(1);
    expect(o.yAxis).toHaveLength(2);
  });
});

describe("forecastLine", () => {
  const monthly = [
    { month: "2026-05", incomeCents: 0, expenseCents: 0, transfersNetCents: 0, balanceCents: 100000 },
    { month: "2026-06", incomeCents: 0, expenseCents: 0, transfersNetCents: 0, balanceCents: 120000 },
  ];
  const forecast = [
    { month: "2026-07", incomeCents: 0, variableCents: 0, recurringCents: 0, billsCents: 0, installmentsCents: 0, expenseCents: 0, balanceCents: 110000 },
    { month: "2026-08", incomeCents: 0, variableCents: 0, recurringCents: 0, billsCents: 0, installmentsCents: 0, expenseCents: 0, balanceCents: 100000 },
  ];

  it("concatena meses reais e previstos; a previsão é tracejada e liga ao último mês real", () => {
    const o = forecastLine(monthly, forecast, colors) as Opt;
    expect(o.xAxis.data).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    expect(o.series[0].data).toEqual([1000, 1200, null, null]);
    expect(o.series[1].data).toEqual([null, 1200, 1100, 1000]);
    expect(o.series[1].lineStyle.type).toBe("dashed");
    expect(o.series[0].lineStyle.type).toBeUndefined();
  });
});

describe("listas vazias", () => {
  it("nenhuma função lança", () => {
    expect(() => spendingPie([], colors)).not.toThrow();
    expect(() => spendingStack({ months: [], series: [] }, colors)).not.toThrow();
    expect(() => budgetBars([], colors)).not.toThrow();
    expect(() => cardDailyLine([], colors)).not.toThrow();
    expect(() => installmentsBars([], colors)).not.toThrow();
    expect(() => cashflowBars([], colors)).not.toThrow();
    expect(() => forecastLine([], [], colors)).not.toThrow();
    expect(series(forecastLine([], [], colors))[0].data).toEqual([]);
  });
});
