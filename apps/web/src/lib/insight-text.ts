import { formatBRL } from "./money";
import { formatDateOnly } from "./date";

export interface InsightLike { type: string; payload: Record<string, unknown> }

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function insightIcon(type: string): string {
  const map: Record<string, string> = { spike: "📈", subscription: "🔄", budget_alert: "⚠️", forecast: "🔮", bill_due: "📅" };
  return map[type] ?? "💡";
}

export function insightTitle(ins: InsightLike): string {
  const p = ins.payload;
  switch (ins.type) {
    case "spike": return `Gasto acima do normal em ${str(p.categoryName)}`;
    case "subscription": return `Assinatura detectada: ${str(p.counterparty)}`;
    case "budget_alert": return `Orçamento ${num(p.pct)}% utilizado`;
    case "forecast": return num(p.forecastBalanceCents) >= 0 ? "Previsão positiva este mês" : "Atenção: déficit previsto";
    case "bill_due": return `Conta a vencer: ${str(p.name)}`;
    default: return ins.type;
  }
}

export function insightDetail(ins: InsightLike): string {
  const p = ins.payload;
  switch (ins.type) {
    case "spike": return `${num(p.pctAboveAvg)}% acima da média (atual ${formatBRL(num(p.currentCents))} vs média ${formatBRL(num(p.avgCents))})`;
    case "subscription": return `Detectada por ${num(p.monthsDetected)} meses · média ${formatBRL(num(p.avgCents))}/mês`;
    case "budget_alert": return `${formatBRL(num(p.spentCents))} gastos de ${formatBRL(num(p.limitCents))} planejados`;
    case "forecast": return str(p.narrative) || `Previsão: ${formatBRL(Math.abs(num(p.forecastBalanceCents)))}`;
    case "bill_due": return `${formatBRL(num(p.amountCents))} vence em ${formatDateOnly(str(p.dueDate))}`;
    default: return "";
  }
}
