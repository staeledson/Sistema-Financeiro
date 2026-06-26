import { ToolResult } from "./chat.gateway";

export type ChartType = "pie" | "bar" | "line";

export interface ChartSpec {
  type: ChartType;
  title: string;
  series: Array<{ name: string; value: number }>;
}

export function buildChart(toolResults: ToolResult[]): ChartSpec | null {
  for (const { name, result } of toolResults) {
    if (name === "get_category_spending") {
      const rows = result as Array<{ name: string; totalCents: number }>;
      if (!rows.length) continue;
      return {
        type: "pie",
        title: "Gastos por categoria",
        series: rows.map((r) => ({ name: r.name, value: r.totalCents })),
      };
    }
    if (name === "get_cashflow_series") {
      const rows = result as Array<{ month: string; incomeCents: number; expenseCents: number }>;
      if (!rows.length) continue;
      return {
        type: "line",
        title: "Fluxo de caixa",
        series: rows.flatMap((r) => [
          { name: `${r.month} receita`, value: r.incomeCents },
          { name: `${r.month} despesa`, value: r.expenseCents },
        ]),
      };
    }
    if (name === "get_cashflow") {
      const r = result as { month: string; incomeCents: number; expenseCents: number };
      return {
        type: "bar",
        title: `Cashflow ${r.month}`,
        series: [
          { name: "Receita", value: r.incomeCents },
          { name: "Despesa", value: r.expenseCents },
        ],
      };
    }
  }
  return null;
}
