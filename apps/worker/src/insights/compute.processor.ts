import { prisma } from "../database";

type InsightUpsertData = {
  workspaceId: string;
  type: string;
  dedupKey: string;
  period: string;
  payload: object;
};

async function upsertInsight(data: InsightUpsertData) {
  const { workspaceId, type, dedupKey, period, payload } = data;
  await prisma.insight.upsert({
    where: { workspaceId_type_dedupKey_period: { workspaceId, type: type as never, dedupKey, period } },
    create: { workspaceId, type: type as never, dedupKey, period, payload, read: false },
    update: { payload, read: false },
  });
}

async function detectSpikes(workspaceId: string, period: string) {
  type SpikRow = { categoryId: string; categoryName: string; currentCents: bigint; avgCents: bigint };

  const rows = await prisma.$queryRaw<SpikRow[]>`
    WITH monthly AS (
      SELECT
        t."categoryId",
        DATE_TRUNC('month', t."date") AS month,
        SUM(t."amountCents") AS total
      FROM transactions t
      WHERE t."workspaceId" = ${workspaceId}
        AND t."type" = 'expense'
        AND t."categoryId" IS NOT NULL
        AND t."date" >= NOW() - INTERVAL '4 months'
      GROUP BY t."categoryId", DATE_TRUNC('month', t."date")
    ),
    current_month AS (
      SELECT "categoryId", total AS "currentCents"
      FROM monthly
      WHERE month = DATE_TRUNC('month', NOW())
    ),
    history_avg AS (
      SELECT "categoryId", AVG(total) AS "avgCents"
      FROM monthly
      WHERE month < DATE_TRUNC('month', NOW())
      GROUP BY "categoryId"
    )
    SELECT
      cm."categoryId",
      c.name AS "categoryName",
      cm."currentCents",
      ha."avgCents"
    FROM current_month cm
    JOIN history_avg ha ON ha."categoryId" = cm."categoryId"
    JOIN categories c ON c.id = cm."categoryId"
    WHERE cm."currentCents" > ha."avgCents" * 1.5
  `;

  for (const row of rows) {
    const pct = Math.round((Number(row.currentCents) / Number(row.avgCents) - 1) * 100);
    await upsertInsight({
      workspaceId,
      type: "spike",
      dedupKey: `spike:${row.categoryId}`,
      period,
      payload: {
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        currentCents: Number(row.currentCents),
        avgCents: Math.round(Number(row.avgCents)),
        pctAboveAvg: pct,
      },
    });
  }
}

async function detectSubscriptions(workspaceId: string, period: string) {
  type SubRow = { counterparty: string; months: bigint; avgCents: bigint };

  const rows = await prisma.$queryRaw<SubRow[]>`
    SELECT
      t."counterparty",
      COUNT(DISTINCT DATE_TRUNC('month', t."date")) AS months,
      AVG(t."amountCents") AS "avgCents"
    FROM transactions t
    WHERE t."workspaceId" = ${workspaceId}
      AND t."type" = 'expense'
      AND t."counterparty" IS NOT NULL
      AND t."date" >= NOW() - INTERVAL '6 months'
    GROUP BY t."counterparty"
    HAVING COUNT(DISTINCT DATE_TRUNC('month', t."date")) >= 3
    ORDER BY "avgCents" DESC
    LIMIT 20
  `;

  for (const row of rows) {
    await upsertInsight({
      workspaceId,
      type: "subscription",
      dedupKey: `sub:${row.counterparty}`,
      period,
      payload: {
        counterparty: row.counterparty,
        monthsDetected: Number(row.months),
        avgCents: Math.round(Number(row.avgCents)),
      },
    });
  }
}

async function detectBudgetAlerts(workspaceId: string, period: string) {
  const budgets = await prisma.budget.findMany({
    where: { workspaceId, categoryId: { not: null } },
    select: { id: true, categoryId: true, limitCents: true },
  });

  if (!budgets.length) return;

  const categoryIds = budgets.map((b) => b.categoryId!);
  type SpendRow = { categoryId: string; total: bigint };
  const spends = await prisma.$queryRaw<SpendRow[]>`
    SELECT "categoryId", SUM("amountCents") AS total
    FROM transactions
    WHERE "workspaceId" = ${workspaceId}
      AND "type" = 'expense'
      AND "categoryId" = ANY(${categoryIds}::text[])
      AND "date" >= DATE_TRUNC('month', NOW())
    GROUP BY "categoryId"
  `;

  const spendMap = new Map(spends.map((s) => [s.categoryId, Number(s.total)]));

  for (const budget of budgets) {
    const spent = spendMap.get(budget.categoryId!) ?? 0;
    const limit = Number(budget.limitCents ?? 0);
    if (!limit) continue;
    const pct = Math.round((spent / limit) * 100);
    if (pct >= 80) {
      await upsertInsight({
        workspaceId,
        type: "budget_alert",
        dedupKey: `budget:${budget.id}`,
        period,
        payload: { budgetId: budget.id, categoryId: budget.categoryId, spentCents: spent, limitCents: limit, pct },
      });
    }
  }
}

export async function computeInsights(data: { workspaceId: string }) {
  const { workspaceId } = data;
  const period = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  await detectSpikes(workspaceId, period);
  await detectSubscriptions(workspaceId, period);
  await detectBudgetAlerts(workspaceId, period);
}
