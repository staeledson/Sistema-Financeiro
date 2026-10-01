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

  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const t of scope) {
    const time = Date.parse(`${t.date}T00:00:00Z`);
    if (time < minTime) minTime = time;
    if (time > maxTime) maxTime = time;
  }
  const windowMs = settings.transferMatchWindowDays * DAY_MS;
  const poolRows = (await prisma.transaction.findMany({
    where: {
      ...base,
      date: { gte: new Date(minTime - windowMs), lte: new Date(maxTime + windowMs) },
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
    prisma.category.findMany({ where: { workspaceId }, select: { id: true, name: true, type: true, entity: true, isSystem: true } }),
    prisma.categoryRule.findMany({
      where: { workspaceId },
      orderBy: { priority: "desc" },
      select: { id: true, matchType: true, pattern: true, categoryId: true, priority: true },
    }),
  ]);

  // Com lançamentos sem conta no escopo, uma consulta sem filtro de entidade já cobre todas as entidades.
  const entities = new Set<AccountEntity | null>(scope.map((t) => t.accountEntity));
  const exampleScopes: Array<AccountEntity | null> = entities.has(null) ? [null] : [...entities];
  const examples: CatExample[] = [];
  const seenExamples = new Set<string>();
  for (const entity of exampleScopes) {
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        categorySource: { in: ["manual", "rule"] },
        categoryId: { not: null },
        ignored: false,
        transferPairId: null,
        ...(entity ? { account: { entity } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: EXAMPLE_POOL,
      select: { counterparty: true, description: true, category: { select: { name: true } }, account: { select: { entity: true } } },
    });
    for (const r of rows) {
      const example: CatExample = { text: txText(r), categoryName: r.category?.name ?? "", entity: r.account?.entity ?? null };
      const key = `${example.text}|${example.categoryName}|${example.entity}`;
      if (seenExamples.has(key)) continue;
      seenExamples.add(key);
      examples.push(example);
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

  // Gravação atômica. Cada updateMany é guardado (linha ainda livre), então só os counts dizem o que mudou de fato.
  await prisma.$transaction(
    async (db) => {
      let transfers = 0;
      for (const p of plan.transferPairs) {
        const pairId = randomUUID();
        const r = await db.transaction.updateMany({
          where: { id: { in: [p.expenseId, p.incomeId] }, workspaceId, transferPairId: null, ignored: false },
          data: { transferPairId: pairId, reviewStatus: "ok", suggestedCategoryId: null, categoryConfidence: null },
        });
        if (r.count === 2) {
          transfers++;
        } else if (r.count > 0) {
          // Meio par (a outra linha mudou no meio do job): desfaz, nunca deixa transferPairId apontando para menos de 2 linhas.
          await db.transaction.updateMany({
            where: { workspaceId, transferPairId: pairId, categoryId: null },
            data: { reviewStatus: "pending" },
          });
          await db.transaction.updateMany({ where: { workspaceId, transferPairId: pairId }, data: { transferPairId: null } });
        }
      }

      let byRule = 0;
      const ruleHits = new Map<string, number>();
      for (const h of plan.byRule) {
        const r = await db.transaction.updateMany({
          where: { id: h.txId, workspaceId, categoryId: null, ignored: false, transferPairId: null },
          data: { categoryId: h.categoryId, categorySource: "rule", categoryConfidence: 1, reviewStatus: "ok", suggestedCategoryId: null },
        });
        byRule += r.count;
        if (r.count > 0) ruleHits.set(h.ruleId, (ruleHits.get(h.ruleId) ?? 0) + r.count);
      }
      // updateMany: uma regra apagada no meio do job não derruba o job.
      for (const [id, n] of ruleHits) {
        await db.categoryRule.updateMany({ where: { id }, data: { hitCount: { increment: n } } });
      }

      let byAi = 0;
      for (const h of plan.byAi) {
        const r = await db.transaction.updateMany({
          where: { id: h.txId, workspaceId, categoryId: null, ignored: false, transferPairId: null },
          data: { categoryId: h.categoryId, categorySource: "ai", categoryConfidence: h.confidence, reviewStatus: "ok", suggestedCategoryId: null },
        });
        byAi += r.count;
      }

      let pending = 0;
      for (const p of plan.pending) {
        const r = await db.transaction.updateMany({
          where: { id: p.txId, workspaceId, categoryId: null, ignored: false, transferPairId: null },
          data: { reviewStatus: "pending", suggestedCategoryId: p.suggestedCategoryId, categoryConfidence: p.confidence },
        });
        pending += r.count;
      }

      await db.aiJob.update({
        where: { id: jobId },
        data: {
          status: "done",
          costTokens: plan.costTokens || null,
          result: { total: scope.length, transfers, byRule, byAi, pending },
        },
      });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
