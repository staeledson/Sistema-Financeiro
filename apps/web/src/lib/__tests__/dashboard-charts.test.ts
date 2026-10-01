import { describe, expect, it } from "vitest";
import {
  averageMonthlyCents, budgetBars, cardDailyLine, cashflowBars, forecastLine, installmentsBars, monthLabel, palette,
  PALETTE_SIZE, pieSlices, reaisToBRL, spendingPie, spendingStack,
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

const manyCats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    categoryId: `c${i}`, name: `Cat ${i}`, totalCents: (n - i) * 1000, previousCents: 0, pct: 0, count: 1,
  }));

describe("paleta e fatias da pizza", () => {
  it("a paleta não repete cor nem inclui quase-duplicatas (income, danger)", () => {
    const pal = palette(colors);
    expect(pal).toHaveLength(PALETTE_SIZE);
    expect(new Set(pal).size).toBe(pal.length);
    expect(pal).not.toContain(colors.income);
    expect(pal).not.toContain(colors.danger);
  });

  it.each([9, 10])("com %i categorias agrupa o excedente em Outras, sem repetir cor", (n) => {
    const data = series(spendingPie(manyCats(n), colors))[0].data as Array<Record<string, any>>;
    expect(data).toHaveLength(PALETTE_SIZE + 1);
    const last = data[data.length - 1];
    expect(last.name).toBe("Outras");
    expect(last.categoryId).toBeNull();
    const rest = manyCats(n).slice(PALETTE_SIZE).reduce((s, c) => s + c.totalCents, 0);
    expect(last.value).toBe(rest / 100);
    const cols = data.map((d) => d.itemStyle.color);
    expect(new Set(cols).size).toBe(cols.length);
    // soma preservada
    expect(data.reduce((s, d) => s + d.value, 0)).toBe(manyCats(n).reduce((s, c) => s + c.totalCents, 0) / 100);
  });

  it("até o tamanho da paleta não cria Outras", () => {
    expect(pieSlices(manyCats(PALETTE_SIZE), PALETTE_SIZE)).toHaveLength(PALETTE_SIZE);
    expect(pieSlices(manyCats(PALETTE_SIZE), PALETTE_SIZE).map((s) => s.name)).not.toContain("Outras");
  });
});

describe("tooltip de valores ausentes", () => {
  it("null, '-', vazio e NaN viram travessão; zero real continua R$ 0,00", () => {
    expect(reaisToBRL(null)).toBe("—");
    expect(reaisToBRL(undefined)).toBe("—");
    expect(reaisToBRL("-")).toBe("—");
    expect(reaisToBRL(Number.NaN)).toBe("—");
    expect(reaisToBRL(0)).toBe(formatBRL(0));
    expect(reaisToBRL(12.5)).toBe(formatBRL(1250));
  });

  it("os gráficos com lacunas usam o formatador que mostra travessão", () => {
    const line = cardDailyLine([{ day: 1, currentCents: null, avgPreviousCents: 0 }], colors) as Opt;
    expect(line.tooltip.valueFormatter(null)).toBe("—");
    expect(line.tooltip.valueFormatter("-")).toBe("—");
    const fc = forecastLine([], [], colors) as Opt;
    expect(fc.tooltip.valueFormatter("-")).toBe("—");
  });
});

describe("averageMonthlyCents", () => {
  it("soma todas as séries e divide pelos meses", () => {
    expect(
      averageMonthlyCents({
        months: ["2026-05", "2026-06"],
        series: [
          { key: "a", categoryId: "a", name: "A", totalsCents: [1000, 3000] },
          { key: "__others", categoryId: null, name: "Outras", totalsCents: [500, 500] },
        ],
      }),
    ).toBe(2500);
    expect(averageMonthlyCents({ months: [], series: [] })).toBe(0);
  });
});

describe("spendingStack", () => {
  it("Outras fica em cor neutra e as demais não repetem", () => {
    const sers = Array.from({ length: PALETTE_SIZE }, (_, i) => ({ key: `k${i}`, categoryId: `k${i}`, name: `K${i}`, totalsCents: [100] }));
    sers.push({ key: "__others", categoryId: null as any, name: "Outras", totalsCents: [100] });
    const o = spendingStack({ months: ["2026-06"], series: sers }, colors) as Opt;
    const cols = o.series.map((x: Opt) => x.itemStyle.color);
    expect(new Set(cols).size).toBe(cols.length);
    expect(cols[cols.length - 1]).toBe(colors.textMuted);
  });

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
        { categoryId: "d", name: "Um centavo", limitCents: 10000, spentCents: 10001, pct: 100 },
      ],
      colors,
    ) as Opt;
    const data = o.series[0].data as Opt[];
    expect(data[0].itemStyle.color).toBe(colors.danger);
    expect(data[1].itemStyle.color).toBe(colors.accent);
    expect(data[2].itemStyle.color).toBe(colors.accent);
    expect(data[3].itemStyle.color).toBe(colors.danger); // gastou mais que o limite, mesmo com pct arredondado em 100
    expect(data[0].categoryId).toBe("a");
    expect(o.yAxis.data).toEqual(["Lazer", "Mercado", "Exato", "Um centavo"]);
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
