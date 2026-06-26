import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class BudgetsService {
  async list(workspaceId: string) {
    return prisma.budget.findMany({
      where: { workspaceId },
      select: { id: true, method: true, categoryId: true, limitCents: true, createdAt: true },
    });
  }

  async upsert(workspaceId: string, body: { method: string; categoryId?: string | null; limitCents?: number | null }) {
    const { method, categoryId, limitCents } = body;
    const existing = await prisma.budget.findFirst({
      where: { workspaceId, method: method as never, categoryId: categoryId ?? null },
      select: { id: true },
    });
    const data = {
      workspaceId,
      method: method as never,
      categoryId: categoryId ?? null,
      limitCents: limitCents != null ? BigInt(limitCents) : null,
    };
    if (existing) {
      return prisma.budget.update({
        where: { id: existing.id },
        data: { limitCents: data.limitCents },
        select: { id: true, method: true, categoryId: true, limitCents: true },
      });
    }
    return prisma.budget.create({
      data,
      select: { id: true, method: true, categoryId: true, limitCents: true },
    });
  }

  async delete(workspaceId: string, id: string) {
    const budget = await prisma.budget.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!budget) throw new NotFoundException("orçamento não encontrado");
    await prisma.budget.delete({ where: { id } });
    return { id };
  }

  async status(workspaceId: string) {
    const budgets = await prisma.budget.findMany({
      where: { workspaceId },
      select: { id: true, method: true, categoryId: true, limitCents: true },
    });

    if (!budgets.length) return [];

    const categoryIds = budgets.filter((b) => b.categoryId).map((b) => b.categoryId!);

    type SpendRow = { categoryId: string | null; total: bigint; incomeTotal: bigint };
    const [spendRows] = await Promise.all([
      prisma.$queryRaw<SpendRow[]>`
        SELECT "categoryId",
          SUM(CASE WHEN "type" = 'expense' THEN "amountCents" ELSE 0 END) AS total,
          SUM(CASE WHEN "type" = 'income' THEN "amountCents" ELSE 0 END) AS "incomeTotal"
        FROM transactions
        WHERE "workspaceId" = ${workspaceId}
          AND "date" >= DATE_TRUNC('month', NOW())
        GROUP BY "categoryId"
      `,
    ]);

    const spendByCat = new Map(spendRows.map((r) => [r.categoryId, Number(r.total)]));
    const totalIncome = spendRows.reduce((s, r) => s + Number(r.incomeTotal), 0);
    const totalExpenses = spendRows.reduce((s, r) => s + Number(r.total), 0);

    return budgets.map((b) => {
      let spentCents: number;
      let limitCents: number;

      const method = b.method as string;
      if (method === "fixed" && b.categoryId) {
        spentCents = spendByCat.get(b.categoryId) ?? 0;
        limitCents = Number(b.limitCents ?? 0);
      } else if (method === "needs") {
        spentCents = totalExpenses;
        limitCents = Math.round(totalIncome * 0.5);
      } else if (method === "wants") {
        spentCents = totalExpenses;
        limitCents = Math.round(totalIncome * 0.3);
      } else {
        // savings bucket
        spentCents = Math.max(0, totalIncome - totalExpenses);
        limitCents = Math.round(totalIncome * 0.2);
      }

      const pct = limitCents > 0 ? Math.round((spentCents / limitCents) * 100) : 0;
      return { id: b.id, method: b.method, categoryId: b.categoryId, limitCents, spentCents, pct };
    });
  }
}
