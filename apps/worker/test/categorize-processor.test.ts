import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => {
  const op = (name: string) => vi.fn((args: unknown) => ({ op: name, args }));
  return {
    settings: vi.fn(),
    txFindMany: vi.fn(),
    categories: vi.fn(),
    rules: vi.fn(),
    txUpdate: op("transaction.update"),
    txUpdateMany: op("transaction.updateMany"),
    ruleUpdate: op("categoryRule.update"),
    jobUpdate: op("aiJob.update"),
    transaction: vi.fn(async (ops: unknown[]) => ops),
  };
});

vi.mock("../src/database", () => ({
  prisma: {
    workspaceSettings: { findUnique: db.settings },
    transaction: { findMany: db.txFindMany, update: db.txUpdate, updateMany: db.txUpdateMany },
    category: { findMany: db.categories },
    categoryRule: { findMany: db.rules, update: db.ruleUpdate },
    aiJob: { update: db.jobUpdate },
    $transaction: db.transaction,
  },
}));

import { processCategorize } from "../src/ai/categorize.processor";

type Row = Record<string, unknown>;
const row = (id: string, over: Row = {}): Row => ({
  id, type: "expense", amountCents: 1000n, date: new Date("2026-06-10"), counterparty: null, description: "Compra",
  accountId: "a-pf", account: { type: "checking", entity: "pf" }, ...over,
});

function setup(scope: Row[], opts: { pool?: Row[]; examples?: Row[]; aiFails?: boolean } = {}) {
  db.settings.mockResolvedValue(null);
  db.categories.mockResolvedValue([{ id: "c-merc", name: "Supermercado", type: "expense", entity: "both" }]);
  db.rules.mockResolvedValue([{ id: "r1", matchType: "contains", pattern: "supermercado", categoryId: "c-merc", priority: 100 }]);
  db.txFindMany.mockImplementation(async (args: { where: Row }) => {
    if ("categorySource" in args.where && typeof args.where["categorySource"] === "object") return opts.examples ?? [];
    if ("date" in args.where) return opts.pool ?? scope;
    return scope;
  });
  const ai = {
    categorizeBatch: opts.aiFails
      ? vi.fn(async () => { throw new Error("sem rede"); })
      : vi.fn(async ({ user }: { user: string }) => ({
          results: (JSON.parse(user).transactions as Array<{ id: string }>).map((t) => ({ transactionId: t.id, categoryId: "c-merc", confidence: 0.95 })),
          costTokens: 7,
        })),
  };
  return ai;
}

beforeEach(() => Object.values(db).forEach((m) => "mockClear" in m && (m as { mockClear: () => void }).mockClear()));

const ops = () => (db.transaction.mock.calls[0][0] as Array<{ op: string; args: Row }>);

describe("processCategorize", () => {
  it("aplica regra, IA e pendência em uma transação e grava o resultado no job", async () => {
    const ai = setup([
      row("t-regra", { description: "Supermercado Extra" }),
      row("t-ia", { description: "Coisa estranha" }),
    ]);
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const all = ops();
    const rule = all.find((o) => o.op === "transaction.update" && (o.args.where as Row).id === "t-regra")!;
    expect(rule.args.data).toMatchObject({ categoryId: "c-merc", categorySource: "rule", categoryConfidence: 1, reviewStatus: "ok", suggestedCategoryId: null });
    const aiHit = all.find((o) => o.op === "transaction.update" && (o.args.where as Row).id === "t-ia")!;
    expect(aiHit.args.data).toMatchObject({ categoryId: "c-merc", categorySource: "ai", categoryConfidence: 0.95, reviewStatus: "ok" });
    expect(all.find((o) => o.op === "categoryRule.update")!.args).toEqual({ where: { id: "r1" }, data: { hitCount: { increment: 1 } } });
    const job = all.find((o) => o.op === "aiJob.update")!;
    expect(job.args.data).toMatchObject({ status: "done", costTokens: 7, result: { total: 2, transfers: 0, byRule: 1, byAi: 1, pending: 0 } });
  });

  it("falha da IA deixa pendente, sem sugestão, e o job termina done", async () => {
    const ai = setup([row("t1", { description: "Coisa estranha" })], { aiFails: true });
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    const pending = ops().find((o) => o.op === "transaction.update")!;
    expect(pending.args.data).toEqual({ reviewStatus: "pending", suggestedCategoryId: null, categoryConfidence: null });
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ status: "done", result: { pending: 1 } });
  });

  it("pareia transferência usando os nomes do titular configurados", async () => {
    db.settings.mockResolvedValue({ aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] });
    const saida = row("s", { description: "Pix para STAEL EDSON", accountId: "a-pj", account: { type: "checking", entity: "pj" } });
    const entrada = row("e", { type: "income", description: "Pix recebido", accountId: "a-pf" });
    const ai = setup([saida, entrada]);
    db.settings.mockResolvedValue({ aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] });
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const pair = ops().find((o) => o.op === "transaction.updateMany")!;
    expect((pair.args.where as { id: { in: string[] } }).id.in.sort()).toEqual(["e", "s"]);
    expect(pair.args.data).toMatchObject({ reviewStatus: "ok" });
    expect(typeof (pair.args.data as Row).transferPairId).toBe("string");
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ result: { transfers: 1 } });
    expect(ai.categorizeBatch).not.toHaveBeenCalled();
  });

  it("com batchId só olha o lote e o que ainda não foi categorizado; sem batchId olha pendentes e sem categoria", async () => {
    const ai = setup([]);
    await processCategorize({ jobId: "job1", workspaceId: "w1", batchId: "b1" }, { ai: ai as never });
    expect(db.txFindMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", importBatchId: "b1", categorySource: "none", ignored: false, transferPairId: null });

    db.txFindMany.mockClear();
    await processCategorize({ jobId: "job2", workspaceId: "w1" }, { ai: setup([]) as never });
    expect(db.txFindMany.mock.calls[0][0].where.OR).toEqual([{ reviewStatus: "pending" }, { categorySource: "none" }]);
  });

  it("escopo vazio só fecha o job com zeros", async () => {
    const ai = setup([]);
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    expect(ai.categorizeBatch).not.toHaveBeenCalled();
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({
      status: "done", result: { total: 0, transfers: 0, byRule: 0, byAi: 0, pending: 0 },
    });
  });
});
