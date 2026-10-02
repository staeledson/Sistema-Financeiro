import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";
import { reportableSql } from "../common/reportable";
import type { BudgetUpsertInput } from "./budgets.controller";

type Bucket = "needs" | "wants" | "savings";
const BUCKET_SHARE: Record<Bucket, number> = { needs: 0.5, wants: 0.3, savings: 0.2 };

export type BudgetStatusRow = {
  id: string;
  method: "fixed" | Bucket;
  categoryId: string | null;
  limitCents: number;
  spentCents: number;
  pct: number;
};

@Injectable()
export class BudgetsService {
  async list(workspaceId: string) {
    return prisma.budget.findMany({
      where: { workspaceId },
      select: { id: true, method: true, categoryId: true, limitCents: true, createdAt: true },
    });
  }

  async upsert(workspaceId: string, body: BudgetUpsertInput) {
    const categoryId = body.method === "fixed" ? body.categoryId! : null;
    if (categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: categoryId, workspaceId }, select: { type: true } });
      if (!cat) throw new BadRequestException("categoria inexistente no workspace");
      if (cat.type !== "expense") throw new BadRequestException("orçamento só para categoria de despesa");
    }
    const limitCents = body.method === "fixed" ? BigInt(body.limitCents!) : null;

    const existing = await prisma.budget.findFirst({
      where: { workspaceId, method: body.method, categoryId },
      select: { id: true },
    });
    const select = { id: true, method: true, categoryId: true, limitCents: true };
    if (existing) return prisma.budget.update({ where: { id: existing.id }, data: { limitCents }, select });
    return prisma.budget.create({ data: { workspaceId, method: body.method, categoryId, limitCents }, select });
  }

  async delete(workspaceId: string, id: string) {
    const budget = await prisma.budget.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!budget) throw new NotFoundException("orçamento não encontrado");
    await prisma.budget.delete({ where: { id } });
    return { id };
  }

  /**
   * Apuração do mês de `asOf`. Buckets 50/30/20 usam a receita do mês como base; `needs` e `wants` ainda não
   * separam por categoria (o campo `Category.bucket` existe, mas não é preenchido), então ambos mostram a despesa total.
   * Um orçamento legado `fifty_thirty_twenty` vira três linhas (mesmo id) para a tela não o esconder.
   */
  async status(workspaceId: string, asOf: string = new Date().toISOString().slice(0, 10)): Promise<BudgetStatusRow[]> {
    const budgets = await prisma.budget.findMany({
      where: { workspaceId },
      select: { id: true, method: true, categoryId: true, limitCents: true },
    });
    if (!budgets.length) return [];

    const monthStart = `${asOf.slice(0, 7)}-01`;
    type SpendRow = { categoryId: string | null; total: bigint; incomeTotal: bigint };
    const spendRows = await prisma.$queryRaw<SpendRow[]>`
      SELECT "categoryId",
        SUM(CASE WHEN "type" = 'expense' THEN "amountCents" ELSE 0 END) AS total,
        SUM(CASE WHEN "type" = 'income' THEN "amountCents" ELSE 0 END) AS "incomeTotal"
      FROM transactions
      WHERE "workspaceId" = ${workspaceId}
        AND "date" >= ${monthStart}::date AND "date" <= ${asOf}::date
        ${reportableSql()}
      GROUP BY "categoryId"
    `;

    const spendByCat = new Map(spendRows.map((r) => [r.categoryId, Number(r.total)]));
    const totalIncome = spendRows.reduce((s, r) => s + Number(r.incomeTotal), 0);
    const totalExpenses = spendRows.reduce((s, r) => s + Number(r.total), 0);

    const bucketRow = (id: string, bucket: Bucket): BudgetStatusRow => {
      const limitCents = Math.round(totalIncome * BUCKET_SHARE[bucket]);
      const spentCents = bucket === "savings" ? Math.max(0, totalIncome - totalExpenses) : totalExpenses;
      return { id, method: bucket, categoryId: null, limitCents, spentCents, pct: limitCents > 0 ? Math.round((spentCents / limitCents) * 100) : 0 };
    };

    return budgets.flatMap((b): BudgetStatusRow[] => {
      if (b.method === "fixed") {
        const spentCents = b.categoryId ? (spendByCat.get(b.categoryId) ?? 0) : 0;
        const limitCents = Number(b.limitCents ?? 0);
        return [{ id: b.id, method: "fixed", categoryId: b.categoryId, limitCents, spentCents, pct: limitCents > 0 ? Math.round((spentCents / limitCents) * 100) : 0 }];
      }
      if (b.method === "fifty_thirty_twenty") return (["needs", "wants", "savings"] as Bucket[]).map((k) => bucketRow(b.id, k));
      return [bucketRow(b.id, b.method as Bucket)];
    });
  }
}
