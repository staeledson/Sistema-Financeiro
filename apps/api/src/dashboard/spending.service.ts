import { Injectable } from "@nestjs/common";
import {
  addMonths, biggestMover, detectRecurring, lastMonths, periodMonths, previousPeriod, stackByMonth,
  type Period, type RecurringInput,
} from "@app/shared";
import { prisma } from "../database";
import { reportableSql } from "../common/reportable";
import { assertScopeAccount, scopeSql, type Scope } from "./dashboard-filter";

export type SpendingFilter = Scope & { period: Period; asOf: string };

type CatRow = { categoryId: string | null; name: string | null; total: bigint; count: bigint };

const NONE = "__none";

@Injectable()
export class SpendingService {
  async get(workspaceId: string, filter: SpendingFilter) {
    await assertScopeAccount(workspaceId, filter.accountId);
    const { period } = filter;
    const scope: Scope = { entity: filter.entity, accountId: filter.accountId };
    const previous = previousPeriod(period);

    const [current, prev] = await Promise.all([
      this.categoryTotals(workspaceId, period, scope),
      this.categoryTotals(workspaceId, previous, scope),
    ]);

    const merged = new Map<string, { categoryId: string | null; name: string; currentCents: number; previousCents: number; count: number }>();
    for (const [rows, isCurrent] of [[current, true], [prev, false]] as const) {
      for (const r of rows) {
        const key = r.categoryId ?? NONE;
        const cur = merged.get(key) ?? { categoryId: r.categoryId, name: r.name ?? "Sem categoria", currentCents: 0, previousCents: 0, count: 0 };
        if (isCurrent) { cur.currentCents = Number(r.total); cur.count = Number(r.count); cur.name = r.name ?? "Sem categoria"; }
        else cur.previousCents = Number(r.total);
        merged.set(key, cur);
      }
    }
    const all = [...merged.values()];
    const totalCents = all.reduce((s, c) => s + c.currentCents, 0);
    const previousTotalCents = all.reduce((s, c) => s + c.previousCents, 0);

    const byCategory = all
      .filter((c) => c.currentCents > 0)
      .sort((a, b) => b.currentCents - a.currentCents || a.name.localeCompare(b.name))
      .map((c) => ({
        categoryId: c.categoryId ?? NONE,
        name: c.name,
        totalCents: c.currentCents,
        previousCents: c.previousCents,
        pct: totalCents > 0 ? Math.round((c.currentCents / totalCents) * 100) : 0,
        count: c.count,
      }));

    const insight = biggestMover(all.map((c) => ({ name: c.name, currentCents: c.currentCents, previousCents: c.previousCents })));

    const [byMonth, vsBudget, topCounterparties, recurring] = await Promise.all([
      this.byMonth(workspaceId, period, scope),
      this.vsBudget(workspaceId, period, byCategory),
      this.topCounterparties(workspaceId, period, scope),
      this.recurring(workspaceId, period.to, scope),
    ]);

    return { period, previousPeriod: previous, totalCents, previousTotalCents, insight, byCategory, byMonth, vsBudget, topCounterparties, recurring };
  }

  /** Despesas do período divididas por entidade da conta (PF/PJ), sempre do workspace inteiro. */
  async entityTotals(workspaceId: string, period: Period) {
    const rows = await prisma.$queryRaw<Array<{ entity: string | null; total: bigint }>>`
      SELECT a."entity"::text AS "entity", SUM(t."amountCents") AS "total"
      FROM transactions t
      LEFT JOIN bank_accounts a ON a."id" = t."accountId" AND a."workspaceId" = t."workspaceId"
      WHERE t."workspaceId" = ${workspaceId} AND t."type" = 'expense'
        AND t."date" >= ${period.from}::date AND t."date" <= ${period.to}::date
        ${reportableSql("t")}
      GROUP BY a."entity"`;
    const of = (e: string) => Number(rows.find((r) => r.entity === e)?.total ?? 0n);
    return { pfCents: of("pf"), pjCents: of("pj") };
  }

  private categoryTotals(workspaceId: string, period: Period, scope: Scope) {
    return prisma.$queryRaw<CatRow[]>`
      SELECT t."categoryId" AS "categoryId", c."name" AS "name", SUM(t."amountCents") AS "total", COUNT(*) AS "count"
      FROM transactions t
      LEFT JOIN categories c ON c."id" = t."categoryId" AND c."workspaceId" = t."workspaceId"
      LEFT JOIN bank_accounts a ON a."id" = t."accountId" AND a."workspaceId" = t."workspaceId"
      WHERE t."workspaceId" = ${workspaceId} AND t."type" = 'expense'
        AND t."date" >= ${period.from}::date AND t."date" <= ${period.to}::date
        ${reportableSql("t")} ${scopeSql(scope)}
      GROUP BY t."categoryId", c."name"`;
  }

  private async byMonth(workspaceId: string, period: Period, scope: Scope) {
    const endYm = period.to.slice(0, 7);
    const months = lastMonths(endYm, 12);
    const rows = await prisma.$queryRaw<Array<{ categoryId: string | null; name: string | null; month: string; total: bigint }>>`
      SELECT t."categoryId" AS "categoryId", c."name" AS "name", to_char(t."date", 'YYYY-MM') AS "month", SUM(t."amountCents") AS "total"
      FROM transactions t
      LEFT JOIN categories c ON c."id" = t."categoryId" AND c."workspaceId" = t."workspaceId"
      LEFT JOIN bank_accounts a ON a."id" = t."accountId" AND a."workspaceId" = t."workspaceId"
      WHERE t."workspaceId" = ${workspaceId} AND t."type" = 'expense'
        AND t."date" >= ${months[0] + "-01"}::date AND t."date" <= ${period.to}::date
        ${reportableSql("t")} ${scopeSql(scope)}
      GROUP BY t."categoryId", c."name", to_char(t."date", 'YYYY-MM')`;
    return stackByMonth(
      rows.map((r) => ({ categoryId: r.categoryId, name: r.name ?? "Sem categoria", month: r.month, totalCents: Number(r.total) })),
      months,
      6,
    );
  }

  private async vsBudget(workspaceId: string, period: Period, byCategory: Array<{ categoryId: string; totalCents: number }>) {
    const budgets = await prisma.budget.findMany({
      where: { workspaceId, method: "fixed", categoryId: { not: null }, limitCents: { not: null } },
      select: { categoryId: true, limitCents: true, category: { select: { name: true } } },
    });
    const factor = periodMonths(period).length;
    const spent = new Map(byCategory.map((c) => [c.categoryId, c.totalCents]));
    return budgets
      .map((b) => {
        const limitCents = Number(b.limitCents) * factor;
        const spentCents = spent.get(b.categoryId!) ?? 0;
        return {
          categoryId: b.categoryId!,
          name: b.category?.name ?? "Sem categoria",
          limitCents,
          spentCents,
          pct: limitCents > 0 ? Math.round((spentCents / limitCents) * 100) : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  }

  private async topCounterparties(workspaceId: string, period: Period, scope: Scope) {
    const rows = await prisma.$queryRaw<Array<{ name: string; total: bigint; count: bigint }>>`
      SELECT COALESCE(NULLIF(t."counterparty", ''), NULLIF(t."description", '')) AS "name", SUM(t."amountCents") AS "total", COUNT(*) AS "count"
      FROM transactions t
      LEFT JOIN bank_accounts a ON a."id" = t."accountId" AND a."workspaceId" = t."workspaceId"
      WHERE t."workspaceId" = ${workspaceId} AND t."type" = 'expense'
        AND t."date" >= ${period.from}::date AND t."date" <= ${period.to}::date
        AND COALESCE(NULLIF(t."counterparty", ''), NULLIF(t."description", '')) IS NOT NULL
        ${reportableSql("t")} ${scopeSql(scope)}
      GROUP BY COALESCE(NULLIF(t."counterparty", ''), NULLIF(t."description", ''))
      ORDER BY SUM(t."amountCents") DESC, 1 ASC
      LIMIT 15`;
    return rows.map((r) => ({ name: r.name, totalCents: Number(r.total), count: Number(r.count) }));
  }

  /** Despesas recorrentes detectadas nos 12 meses que terminam em `to` (só despesas; parceladas ficam de fora). */
  async recurring(workspaceId: string, to: string, scope: Scope) {
    const from = addMonths(to.slice(0, 7), -11) + "-01";
    const rows = await prisma.$queryRaw<
      Array<{ description: string | null; amountCents: bigint; date: string; installmentTotal: number | null }>
    >`
      SELECT COALESCE(NULLIF(t."description", ''), NULLIF(t."counterparty", '')) AS "description", t."amountCents", to_char(t."date", 'YYYY-MM-DD') AS "date", t."installmentTotal"
      FROM transactions t
      LEFT JOIN bank_accounts a ON a."id" = t."accountId" AND a."workspaceId" = t."workspaceId"
      WHERE t."workspaceId" = ${workspaceId} AND t."type" = 'expense'
        AND t."date" >= ${from}::date AND t."date" <= ${to}::date
        ${reportableSql("t")} ${scopeSql(scope)}
      ORDER BY t."date" DESC
      LIMIT 20000`;
    const inputs: RecurringInput[] = rows
      .map((r) => ({
        description: r.description ?? "",
        amountCents: Number(r.amountCents),
        date: r.date,
        installment: r.installmentTotal != null,
      }))
      .filter((r) => r.description);
    return detectRecurring(inputs);
  }
}
