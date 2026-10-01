/**
 * Construtores de opções ECharts do Painel: funções puras (dados da API + cores do tema → opção).
 * Valores chegam em centavos; os eixos e séries ficam em reais e a formatação usa `formatBRL`.
 */
import type { EChartsOption } from "echarts";
import type {
  BudgetUsage, CardCycleDay, CardInstallmentMonth, CashflowMonth, ForecastMonth, SpendingByMonth, SpendingCategory,
} from "./api";
import { formatBRL, formatBRLCompact } from "./money";
import type { ThemeColors } from "./theme-colors";

const toReais = (cents: number) => cents / 100;
const reaisToBRL = (v: unknown) => formatBRL(Math.round(Number(v) * 100));
const reaisToCompact = (v: number) => formatBRLCompact(Math.round(v * 100));

/** "2026-06" → "06/26". */
export function monthLabel(ym: string): string {
  return `${ym.slice(5, 7)}/${ym.slice(2, 4)}`;
}

/** Paleta categórica derivada dos tokens do tema (cicla quando há mais séries que cores). */
export function palette(c: ThemeColors): string[] {
  return [c.accent, c.pf, c.pj, c.expense, c.transfer, c.warning, c.income, c.danger];
}

function base(c: ThemeColors): EChartsOption {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: c.fontSans, color: c.textMuted },
    tooltip: {
      backgroundColor: c.surface,
      borderColor: c.border,
      textStyle: { color: c.text, fontFamily: c.fontSans },
      valueFormatter: reaisToBRL,
    },
    legend: { textStyle: { color: c.textMuted }, icon: "roundRect", itemWidth: 10, itemHeight: 10 },
  };
}

function valueAxis(c: ThemeColors, extra: Record<string, unknown> = {}) {
  return {
    type: "value" as const,
    axisLabel: { color: c.textMuted, formatter: reaisToCompact },
    splitLine: { lineStyle: { color: c.border } },
    ...extra,
  };
}

function categoryAxis(c: ThemeColors, data: Array<string | number>, formatter?: (v: string) => string) {
  return {
    type: "category" as const,
    data,
    axisLine: { lineStyle: { color: c.border } },
    axisTick: { show: false },
    axisLabel: { color: c.textMuted, ...(formatter ? { formatter } : {}) },
  };
}

const GRID = { left: 8, right: 12, top: 36, bottom: 8, containLabel: true };

export function spendingPie(byCategory: SpendingCategory[], colors: ThemeColors): EChartsOption {
  const pal = palette(colors);
  return {
    ...base(colors),
    tooltip: { ...(base(colors).tooltip as object), trigger: "item" },
    legend: { ...(base(colors).legend as object), type: "scroll", bottom: 0 },
    series: [
      {
        type: "pie",
        radius: ["45%", "70%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        label: { show: false },
        itemStyle: { borderColor: colors.surface, borderWidth: 2 },
        data: byCategory.map((c, i) => ({
          name: c.name,
          value: toReais(c.totalCents),
          categoryId: c.categoryId,
          itemStyle: { color: pal[i % pal.length] },
        })),
      },
    ],
  };
}

export function spendingStack(byMonth: SpendingByMonth, colors: ThemeColors): EChartsOption {
  const pal = palette(colors);
  return {
    ...base(colors),
    tooltip: { ...(base(colors).tooltip as object), trigger: "axis" },
    legend: { ...(base(colors).legend as object), type: "scroll", top: 0 },
    grid: GRID,
    xAxis: categoryAxis(colors, byMonth.months, monthLabel),
    yAxis: valueAxis(colors),
    series: byMonth.series.map((s, i) => ({
      type: "bar" as const,
      name: s.name,
      stack: "total",
      data: s.totalsCents.map(toReais),
      itemStyle: { color: pal[i % pal.length] },
    })),
  };
}

/** Uso do orçamento em %: a barra que passa de 100% fica na cor de perigo. */
export function budgetBars(vsBudget: BudgetUsage[], colors: ThemeColors): EChartsOption {
  const maxPct = Math.max(100, ...vsBudget.map((b) => b.pct));
  return {
    ...base(colors),
    tooltip: {
      ...(base(colors).tooltip as object),
      trigger: "item",
      formatter: (p: unknown) => {
        const d = (p as { data: { name: string; spentCents: number; limitCents: number; value: number } }).data;
        return `${d.name}: ${formatBRL(d.spentCents)} de ${formatBRL(d.limitCents)} (${d.value}%)`;
      },
    },
    legend: { show: false },
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    xAxis: {
      type: "value",
      max: maxPct,
      axisLabel: { color: colors.textMuted, formatter: "{value}%" },
      splitLine: { lineStyle: { color: colors.border } },
    },
    yAxis: { ...categoryAxis(colors, vsBudget.map((b) => b.name)), inverse: true },
    series: [
      {
        type: "bar",
        barMaxWidth: 18,
        data: vsBudget.map((b) => ({
          name: b.name,
          value: b.pct,
          spentCents: b.spentCents,
          limitCents: b.limitCents,
          categoryId: b.categoryId,
          itemStyle: { color: b.pct > 100 ? colors.danger : colors.accent },
        })),
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { color: colors.textMuted, type: "dashed" },
          data: [{ xAxis: 100 }],
        },
      },
    ],
  };
}

/** Acumulado do ciclo atual (para no último dia já corrido) contra a média dos ciclos anteriores. */
export function cardDailyLine(cycleDaily: CardCycleDay[], colors: ThemeColors): EChartsOption {
  return {
    ...base(colors),
    tooltip: { ...(base(colors).tooltip as object), trigger: "axis" },
    legend: { ...(base(colors).legend as object), top: 0 },
    grid: GRID,
    xAxis: categoryAxis(colors, cycleDaily.map((d) => d.day)),
    yAxis: valueAxis(colors),
    series: [
      {
        type: "line",
        name: "Ciclo atual",
        showSymbol: false,
        connectNulls: false,
        data: cycleDaily.map((d) => (d.currentCents == null ? null : toReais(d.currentCents))),
        lineStyle: { color: colors.accent, width: 2 },
        itemStyle: { color: colors.accent },
      },
      {
        type: "line",
        name: "Média anterior",
        showSymbol: false,
        data: cycleDaily.map((d) => toReais(d.avgPreviousCents)),
        lineStyle: { color: colors.textMuted, width: 1.5, type: "dashed" },
        itemStyle: { color: colors.textMuted },
      },
    ],
  };
}

export function installmentsBars(installmentsAhead: CardInstallmentMonth[], colors: ThemeColors): EChartsOption {
  return {
    ...base(colors),
    tooltip: { ...(base(colors).tooltip as object), trigger: "axis" },
    legend: { show: false },
    grid: { ...GRID, top: 12 },
    xAxis: categoryAxis(colors, installmentsAhead.map((m) => m.month), monthLabel),
    yAxis: valueAxis(colors),
    series: [
      {
        type: "bar",
        name: "Parcelas",
        barMaxWidth: 24,
        data: installmentsAhead.map((m) => toReais(m.amountCents)),
        itemStyle: { color: colors.transfer },
      },
    ],
  };
}

/** Receitas e despesas por mês (eixo esquerdo) e saldo do fim do mês (linha no eixo direito). */
export function cashflowBars(monthly: CashflowMonth[], colors: ThemeColors): EChartsOption {
  return {
    ...base(colors),
    tooltip: { ...(base(colors).tooltip as object), trigger: "axis" },
    legend: { ...(base(colors).legend as object), top: 0 },
    grid: { ...GRID, right: 8 },
    xAxis: categoryAxis(colors, monthly.map((m) => m.month), monthLabel),
    yAxis: [valueAxis(colors), valueAxis(colors, { splitLine: { show: false } })],
    series: [
      { type: "bar", name: "Receitas", barMaxWidth: 18, data: monthly.map((m) => toReais(m.incomeCents)), itemStyle: { color: colors.income } },
      { type: "bar", name: "Despesas", barMaxWidth: 18, data: monthly.map((m) => toReais(m.expenseCents)), itemStyle: { color: colors.expense } },
      {
        type: "line",
        name: "Saldo",
        yAxisIndex: 1,
        showSymbol: false,
        data: monthly.map((m) => toReais(m.balanceCents)),
        lineStyle: { color: colors.accent, width: 2 },
        itemStyle: { color: colors.accent },
      },
    ],
  };
}

/** Saldo realizado dos 12 meses seguido do saldo previsto (tracejado, ligado ao último mês real). */
export function forecastLine(monthly: CashflowMonth[], forecast: ForecastMonth[], colors: ThemeColors): EChartsOption {
  const months = [...monthly.map((m) => m.month), ...forecast.map((f) => f.month)];
  const real: Array<number | null> = [...monthly.map((m) => toReais(m.balanceCents)), ...forecast.map(() => null)];
  const projected: Array<number | null> = [...monthly.map(() => null), ...forecast.map((f) => toReais(f.balanceCents))];
  if (monthly.length > 0 && forecast.length > 0) projected[monthly.length - 1] = toReais(monthly[monthly.length - 1].balanceCents);
  return {
    ...base(colors),
    tooltip: { ...(base(colors).tooltip as object), trigger: "axis" },
    legend: { ...(base(colors).legend as object), top: 0 },
    grid: GRID,
    xAxis: categoryAxis(colors, months, monthLabel),
    yAxis: valueAxis(colors),
    series: [
      {
        type: "line",
        name: "Saldo realizado",
        showSymbol: false,
        connectNulls: false,
        data: real,
        lineStyle: { color: colors.accent, width: 2 },
        itemStyle: { color: colors.accent },
      },
      {
        type: "line",
        name: "Saldo previsto",
        showSymbol: true,
        symbolSize: 6,
        connectNulls: false,
        data: projected,
        lineStyle: { color: colors.accent, width: 2, type: "dashed" },
        itemStyle: { color: colors.accent },
      },
    ],
  };
}
