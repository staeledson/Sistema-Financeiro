import { randomUUID } from "node:crypto";
import { DEFAULT_WORKSPACE_SETTINGS, type AccountEntity, type AccountType, type TransferCandidate } from "@app/shared";
import { prisma } from "../database";
import {
  planCategorization,
  txText,
  type CatCategory, type CatExample, type CatRule, type CatTx, type CategorizeAi,
} from "./categorize.core";

export interface CategorizeJobData {
  jobId: string;
  workspaceId: string;
  /** Quando informado, categoriza só as transações desse lote de importação. */
  batchId?: string;
}

const DAY_MS = 86_400_000;
const EXAMPLE_POOL = 300;

const TX_SELECT = {
  id: true,
  type: true,
  amountCents: true,
  date: true,
  counterparty: true,
  description: true,
  accountId: true,
  account: { select: { type: true, entity: true } },
} as const;

type TxRow = {
  id: string;
  type: "income" | "expense" | "transfer";
  amountCents: bigint;
  date: Date;
  counterparty: string | null;
  description: string | null;
  accountId: string | null;
  account: { type: AccountType; entity: AccountEntity } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

function toCatTx(r: TxRow): CatTx {
  return {
    id: r.id,
    type: r.type as "income" | "expense",
    amountCents: Number(r.amountCents),
    date: iso(r.date),
    counterparty: r.counterparty,
    description: r.description,
    accountId: r.accountId,
    accountType: r.account?.type ?? null,
    accountEntity: r.account?.entity ?? null,
  };
}

export async function processCategorize(data: CategorizeJobData, deps: { ai: CategorizeAi }) {
  const { jobId, workspaceId, batchId } = data;

  const settingsRow = await prisma.workspaceSettings.findUnique({
    where: { workspaceId },
    select: { aiConfidenceThreshold: true, aiBatchSize: true, transferMatchWindowDays: true, ownerNames: true },
  });
  const settings = settingsRow ?? DEFAULT_WORKSPACE_SETTINGS;

  const base = { workspaceId, type: { in: ["income", "expense"] as Array<"income" | "expense"> }, ignored: false, transferPairId: null };
  const scopeRows = (await prisma.transaction.findMany({
    where: batchId
      ? { ...base, categoryId: null, importBatchId: batchId, categorySource: "none" }
      : { ...base, categoryId: null, OR: [{ reviewStatus: "pending" }, { categorySource: "none" }] },
    select: TX_SELECT,
  })) as unknown as TxRow[];
  const scope = scopeRows.map(toCatTx);

  if (scope.length === 0) {
    await prisma.$transaction([
      prisma.aiJob.update({
        where: { id: jobId },
        data: { status: "done", result: { total: 0, transfers: 0, byRule: 0, byAi: 0, pending: 0 } },
      }),
    ]);
    return;
  }

  const times = scope.map((t) => Date.parse(`${t.date}T00:00:00Z`));
  const windowMs = settings.transferMatchWindowDays * DAY_MS;
  const poolRows = (await prisma.transaction.findMany({
    where: {
      ...base,
      date: { gte: new Date(Math.min(...times) - windowMs), lte: new Date(Math.max(...times) + windowMs) },
    },
    select: TX_SELECT,
  })) as unknown as TxRow[];
  const pairPool: TransferCandidate[] = poolRows
    .filter((r) => r.accountId && r.account)
    .map((r) => ({
      id: r.id,
      accountId: r.accountId!,
      accountType: r.account!.type,
      type: r.type as "income" | "expense",
      amountCents: Number(r.amountCents),
      date: iso(r.date),
      text: txText(r),
    }));

  const [categories, rules] = await Promise.all([
    prisma.category.findMany({ where: { workspaceId }, select: { id: true, name: true, type: true, entity: true } }),
    prisma.categoryRule.findMany({
      where: { workspaceId },
      orderBy: { priority: "desc" },
      select: { id: true, matchType: true, pattern: true, categoryId: true, priority: true },
    }),
  ]);

  const entities = new Set<AccountEntity | null>(scope.map((t) => t.accountEntity));
  const examples: CatExample[] = [];
  for (const entity of entities) {
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        categorySource: { in: ["manual", "rule"] },
        categoryId: { not: null },
        ...(entity ? { account: { entity } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: EXAMPLE_POOL,
      select: { counterparty: true, description: true, category: { select: { name: true } }, account: { select: { entity: true } } },
    });
    for (const r of rows) {
      examples.push({ text: txText(r), categoryName: r.category?.name ?? "", entity: r.account?.entity ?? null });
    }
  }

  const plan = await planCategorization(
    {
      scope,
      pairPool,
      categories: categories as CatCategory[],
      rules: rules as CatRule[],
      examples,
      settings,
    },
    deps.ai,
  );

  const ruleHits = new Map<string, number>();
  for (const h of plan.byRule) ruleHits.set(h.ruleId, (ruleHits.get(h.ruleId) ?? 0) + 1);

  await prisma.$transaction([
    ...plan.transferPairs.map((p) =>
      prisma.transaction.updateMany({
        where: { id: { in: [p.expenseId, p.incomeId] }, workspaceId },
        data: { transferPairId: randomUUID(), reviewStatus: "ok" },
      }),
    ),
    ...plan.byRule.map((h) =>
      prisma.transaction.update({
        where: { id: h.txId },
        data: { categoryId: h.categoryId, categorySource: "rule", categoryConfidence: 1, reviewStatus: "ok", suggestedCategoryId: null },
      }),
    ),
    ...[...ruleHits].map(([id, n]) => prisma.categoryRule.update({ where: { id }, data: { hitCount: { increment: n } } })),
    ...plan.byAi.map((h) =>
      prisma.transaction.update({
        where: { id: h.txId },
        data: { categoryId: h.categoryId, categorySource: "ai", categoryConfidence: h.confidence, reviewStatus: "ok", suggestedCategoryId: null },
      }),
    ),
    ...plan.pending.map((p) =>
      prisma.transaction.update({
        where: { id: p.txId },
        data: { reviewStatus: "pending", suggestedCategoryId: p.suggestedCategoryId, categoryConfidence: p.confidence },
      }),
    ),
    prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        costTokens: plan.costTokens || null,
        result: {
          total: scope.length,
          transfers: plan.transferPairs.length,
          byRule: plan.byRule.length,
          byAi: plan.byAi.length,
          pending: plan.pending.length,
        },
      },
    }),
  ]);
}
