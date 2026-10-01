import { z } from "zod";
import { prisma } from "../database";
import { REPORTABLE } from "../common/reportable";
import type { Prisma } from "../../generated/prisma/client";
import { BalancesService } from "../balances/balances.service";

export type Ctx = { workspaceId: string };

const balances = new BalancesService();

const monthArg = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

function parseMonth(month: string): { start: Date; end: Date } {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Nome exato (sem diferenciar caixa) vence; sem exato, valem todos os que contêm o texto. */
function matchByName<T extends { name: string }>(rows: T[], name: string): T[] {
  const n = name.trim().toLowerCase();
  const exact = rows.filter((r) => r.name.toLowerCase() === n);
  return exact.length ? exact : rows.filter((r) => r.name.toLowerCase().includes(n));
}

/** `null` = sem filtro; `[]` = nome informado que não casa com nada (a busca volta vazia). */
async function resolveCategoryIds(ctx: Ctx, name?: string | null): Promise<string[] | null> {
  if (!name?.trim()) return null;
  const rows = await prisma.category.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true } });
  return matchByName(rows, name).map((r) => r.id);
}

async function resolveAccountIds(ctx: Ctx, name?: string | null): Promise<string[] | null> {
  if (!name?.trim()) return null;
  const rows = await prisma.bankAccount.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true } });
  return matchByName(rows, name).map((r) => r.id);
}

export const TOOLS = {
  get_balance: {
    schema: z.object({}),
    def: {
      name: "get_balance",
      description:
        "Saldos do workspace ativo: consolidatedCents = saldo em contas (caixa, SEM cartões de crédito); cardsCents = dívida dos cartões de crédito (negativo = a pagar), à parte; e accounts = saldo de cada conta, cartões inclusos.",
      parameters: { type: "object" as const, properties: {} },
    },
    async run(_a: Record<string, never>, ctx: Ctx) {
      return balances.getForWorkspace(ctx.workspaceId);
    },
  },

  get_cashflow: {
    schema: monthArg,
    def: {
      name: "get_cashflow",
      description: "Receita e despesa total de um mês (formato YYYY-MM).",
      parameters: {
        type: "object" as const,
        properties: { month: { type: "string", description: "Mês no formato YYYY-MM, ex: 2026-06" } },
        required: ["month"],
      },
    },
    async run(a: { month: string }, ctx: Ctx) {
      const { start, end } = parseMonth(a.month);
      const txs = await prisma.transaction.findMany({
        where: { workspaceId: ctx.workspaceId, type: { in: ["income", "expense"] }, date: { gte: start, lt: end }, ...REPORTABLE },
        select: { type: true, amountCents: true },
      });
      let incomeCents = 0, expenseCents = 0;
      for (const tx of txs) {
        if (tx.type === "income") incomeCents += Number(tx.amountCents);
        else expenseCents += Number(tx.amountCents);
      }
      return { month: a.month, incomeCents, expenseCents };
    },
  },

  get_category_spending: {
    schema: monthArg.extend({ type: z.enum(["income", "expense"]).default("expense") }),
    def: {
      name: "get_category_spending",
      description: "Gasto (ou receita) por categoria em um mês.",
      parameters: {
        type: "object" as const,
        properties: {
          month: { type: "string", description: "Mês no formato YYYY-MM" },
          type: { type: "string", enum: ["income", "expense"] },
        },
        required: ["month"],
      },
    },
    async run(a: { month: string; type: "income" | "expense" }, ctx: Ctx) {
      const { start, end } = parseMonth(a.month);
      const rows = await prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { workspaceId: ctx.workspaceId, type: a.type, date: { gte: start, lt: end }, ...REPORTABLE },
        _sum: { amountCents: true },
        orderBy: { _sum: { amountCents: "desc" } },
      });
      const catIds = rows.map((r) => r.categoryId).filter(Boolean) as string[];
      const cats = await prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } });
      const catMap = new Map(cats.map((c) => [c.id, c.name]));
      return rows.map((r) => ({
        categoryId: r.categoryId,
        name: catMap.get(r.categoryId ?? "") ?? "Sem categoria",
        totalCents: Number(r._sum.amountCents ?? 0),
      }));
    },
  },

  get_cashflow_series: {
    schema: z.object({ months: z.number().int().min(1).max(12).default(6) }),
    def: {
      name: "get_cashflow_series",
      description: "Série histórica de receita e despesa dos últimos N meses (até 12).",
      parameters: {
        type: "object" as const,
        properties: { months: { type: "integer", description: "Quantidade de meses passados (padrão 6)" } },
      },
    },
    async run(a: { months: number }, ctx: Ctx) {
      const series: Array<{ month: string; incomeCents: number; expenseCents: number }> = [];
      const now = new Date();
      for (let i = a.months - 1; i >= 0; i--) {
        const m = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
        const monthStr = m.toISOString().slice(0, 7);
        const { start, end } = parseMonth(monthStr);
        const txs = await prisma.transaction.findMany({
          where: { workspaceId: ctx.workspaceId, type: { in: ["income", "expense"] }, date: { gte: start, lt: end }, ...REPORTABLE },
          select: { type: true, amountCents: true },
        });
        let incomeCents = 0, expenseCents = 0;
        for (const tx of txs) {
          if (tx.type === "income") incomeCents += Number(tx.amountCents);
          else expenseCents += Number(tx.amountCents);
        }
        series.push({ month: monthStr, incomeCents, expenseCents });
      }
      return series;
    },
  },

  search_transactions: {
    schema: z.object({
      from: z.string().nullish(),
      to: z.string().nullish(),
      categoryName: z.string().nullish(),
      accountName: z.string().nullish(),
      q: z.string().nullish(),
      minAmountCents: z.number().int().nullish(),
      maxAmountCents: z.number().int().nullish(),
    }),
    def: {
      name: "search_transactions",
      description: "Busca transações por período, categoria, conta, texto livre ou valor.",
      parameters: {
        type: "object" as const,
        properties: {
          from: { type: "string", description: "Data início YYYY-MM-DD" },
          to: { type: "string", description: "Data fim YYYY-MM-DD" },
          categoryName: { type: "string" },
          accountName: { type: "string" },
          q: { type: "string", description: "Texto livre na descrição" },
          minAmountCents: { type: "integer" },
          maxAmountCents: { type: "integer" },
        },
      },
    },
    async run(a: {
      from?: string | null; to?: string | null;
      categoryName?: string | null; accountName?: string | null;
      q?: string | null; minAmountCents?: number | null; maxAmountCents?: number | null;
    }, ctx: Ctx) {
      const [categoryIds, accountIds] = await Promise.all([
        resolveCategoryIds(ctx, a.categoryName),
        resolveAccountIds(ctx, a.accountName),
      ]);

      const where: Record<string, unknown> = { workspaceId: ctx.workspaceId };
      if (a.from) where.date = { ...((where.date as object) ?? {}), gte: new Date(a.from) };
      if (a.to) where.date = { ...((where.date as object) ?? {}), lte: new Date(a.to) };
      if (categoryIds) where.categoryId = { in: categoryIds };
      if (accountIds) where.accountId = { in: accountIds };
      if (a.q) where.description = { contains: a.q, mode: "insensitive" };
      if (a.minAmountCents != null) where.amountCents = { ...((where.amountCents as object) ?? {}), gte: BigInt(a.minAmountCents) };
      if (a.maxAmountCents != null) where.amountCents = { ...((where.amountCents as object) ?? {}), lte: BigInt(a.maxAmountCents) };

      const rows = await prisma.transaction.findMany({
        where: where as Prisma.TransactionWhereInput,
        orderBy: { date: "desc" },
        take: 50,
        select: { id: true, type: true, amountCents: true, date: true, description: true, categoryId: true },
      });
      return rows.map((r) => ({ ...r, amountCents: Number(r.amountCents), date: r.date.toISOString().slice(0, 10) }));
    },
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_DEFS = Object.values(TOOLS).map((t) => ({ type: "function", function: t.def }));
