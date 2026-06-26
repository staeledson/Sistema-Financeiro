import { Injectable } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class DashboardService {
  async monthCashflow(workspaceId: string, month: Date) {
    const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

    const txs = await prisma.transaction.findMany({
      where: { workspaceId, type: { in: ["income", "expense"] }, date: { gte: start, lt: end } },
      select: { type: true, amountCents: true },
    });

    let incomeCents = 0, expenseCents = 0;
    for (const tx of txs) {
      if (tx.type === "income") incomeCents += Number(tx.amountCents);
      else expenseCents += Number(tx.amountCents);
    }
    return { incomeCents, expenseCents };
  }

  async categoryBreakdown(workspaceId: string, month: Date, type: "income" | "expense") {
    const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

    const rows = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { workspaceId, type, categoryId: { not: null }, date: { gte: start, lt: end } },
      _sum: { amountCents: true },
      orderBy: { _sum: { amountCents: "desc" } },
    });

    const categoryIds = rows.map((r) => r.categoryId!);
    const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } });
    const catMap = new Map(categories.map((c) => [c.id, c.name]));

    return rows.map((r) => ({
      categoryId: r.categoryId,
      name: catMap.get(r.categoryId!) ?? "Sem categoria",
      totalCents: Number(r._sum.amountCents ?? 0),
    }));
  }

  async cashflowSeries(workspaceId: string, months: number) {
    const series: Array<{ month: string; incomeCents: number; expenseCents: number }> = [];
    for (let i = months - 1; i >= 0; i--) {
      const now = new Date();
      const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const { incomeCents, expenseCents } = await this.monthCashflow(workspaceId, m);
      series.push({ month: m.toISOString().slice(0, 7), incomeCents, expenseCents });
    }
    return series;
  }

  async get(workspaceId: string, monthStr: string) {
    const month = new Date(monthStr + "-01T00:00:00Z");
    const [cashflow, expenseBreakdown, incomeSeries] = await Promise.all([
      this.monthCashflow(workspaceId, month),
      this.categoryBreakdown(workspaceId, month, "expense"),
      this.cashflowSeries(workspaceId, 6),
    ]);
    return { cashflow, expenseBreakdown, cashflowSeries: incomeSeries };
  }
}
