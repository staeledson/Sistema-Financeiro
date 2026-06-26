import { prisma } from "../database";
import type { OpenRouterGateway } from "../ai/openrouter";

type MonthRow = { month: Date; income: bigint; expenses: bigint };

export async function computeCashflowForecast(
  data: { workspaceId: string },
  deps: { ai: OpenRouterGateway },
) {
  const { workspaceId } = data;

  const rows = await prisma.$queryRaw<MonthRow[]>`
    SELECT
      DATE_TRUNC('month', "date") AS month,
      SUM(CASE WHEN "type" = 'income' THEN "amountCents" ELSE 0 END) AS income,
      SUM(CASE WHEN "type" = 'expense' THEN "amountCents" ELSE 0 END) AS expenses
    FROM transactions
    WHERE "workspaceId" = ${workspaceId}
      AND "date" >= NOW() - INTERVAL '3 months'
      AND "date" < DATE_TRUNC('month', NOW())
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  if (!rows.length) return null;

  const avgIncome = rows.reduce((s, r) => s + Number(r.income), 0) / rows.length;
  const avgExpenses = rows.reduce((s, r) => s + Number(r.expenses), 0) / rows.length;
  const forecastBalance = Math.round(avgIncome - avgExpenses);

  const period = new Date().toISOString().slice(0, 7);

  const narratePrompt =
    `Nos últimos ${rows.length} meses: receita média R$${(avgIncome / 100).toFixed(2)}, ` +
    `despesa média R$${(avgExpenses / 100).toFixed(2)}. ` +
    `Previsão para este mês: ${forecastBalance >= 0 ? "sobra" : "falta"} R$${Math.abs(forecastBalance / 100).toFixed(2)}. ` +
    `Escreva um resumo financeiro em 2 frases.`;

  const narrative = await deps.ai.narrate(narratePrompt);

  await prisma.insight.upsert({
    where: {
      workspaceId_type_dedupKey_period: {
        workspaceId,
        type: "cashflow_forecast" as never,
        dedupKey: "cashflow",
        period,
      },
    },
    create: {
      workspaceId,
      type: "cashflow_forecast" as never,
      dedupKey: "cashflow",
      period,
      payload: {
        avgIncomeCents: Math.round(avgIncome),
        avgExpensesCents: Math.round(avgExpenses),
        forecastBalanceCents: forecastBalance,
        narrative,
      },
      read: false,
    },
    update: {
      payload: {
        avgIncomeCents: Math.round(avgIncome),
        avgExpensesCents: Math.round(avgExpenses),
        forecastBalanceCents: forecastBalance,
        narrative,
      },
      read: false,
    },
  });

  return { forecastBalanceCents: forecastBalance, narrative };
}
