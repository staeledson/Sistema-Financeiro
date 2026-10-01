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
    // Operações feitas dentro da transação interativa, em ordem.
    log: [] as Array<{ op: string; args: Record<string, unknown> }>,
    // Quantas linhas cada updateMany "alterou": por padrão 1 (ou 2 para um par); testes sobrescrevem.
    countFor: { fn: (_op: string, args: { where: { id?: unknown } }): number => (typeof args.where.id === "object" ? 2 : 1) },
    transaction: vi.fn(),
  };
});

db.transaction.mockImplementation(async (arg: unknown) => {
  if (typeof arg !== "function") return arg;
  const rec = (name: string) => async (args: { where: { id?: unknown } }) => {
    db.log.push({ op: name, args: args as never });
    return { count: db.countFor.fn(name, args) };
  };
  return (arg as (c: unknown) => Promise<unknown>)({
    transaction: { updateMany: rec("transaction.updateMany") },
    categoryRule: { updateMany: rec("categoryRule.updateMany") },
    aiJob: { update: async (args: never) => { db.log.push({ op: "aiJob.update", args }); return {}; } },
  });
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
import { MAX_AI_ROWS_PER_JOB } from "../src/ai/categorize.core";

type Row = Record<string, unknown>;
const row = (id: string, over: Row = {}): Row => ({
  id, type: "expense", amountCents: 1000n, date: new Date("2026-06-10"), counterparty: null, description: "Compra",
  accountId: "a-pf", account: { type: "checking", entity: "pf" }, ...over,
});

function setup(scope: Row[], opts: { pool?: Row[]; examples?: Row[]; aiFails?: boolean; lowConfidenceIds?: string[]; settings?: Row } = {}) {
  db.settings.mockResolvedValue(opts.settings ?? null);
  // Espelha o seed real: todas as categorias de fábrica são isSystem.
  db.categories.mockResolvedValue([
    { id: "c-merc", name: "Supermercado", type: "expense", entity: "both", isSystem: true },
    { id: "c-outras", name: "Outras despesas", type: "expense", entity: "both", isSystem: true },
  ]);
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
          results: (JSON.parse(user).transactions as Array<{ id: string }>).map((t) => ({ transactionId: t.id, categoryId: "c-merc", confidence: (opts.lowConfidenceIds ?? []).includes(t.id) ? 0.5 : 0.95 })),
          costTokens: 7,
        })),
  };
  return ai;
}

beforeEach(() => {
  Object.values(db).forEach((m) => typeof m === "function" && "mockClear" in m && (m as { mockClear: () => void }).mockClear());
  db.log.length = 0;
  db.countFor.fn = (_op, args) => (typeof args.where.id === "object" ? 2 : 1);
});

const ops = () => (db.log.length ? db.log : (db.transaction.mock.calls[0][0] as Array<{ op: string; args: Row }>)) as Array<{ op: string; args: Row }>;

describe("processCategorize", () => {
  it("aplica regra, IA e pendência em uma transação, só em linhas ainda livres, e grava o resultado no job", async () => {
    const ai = setup(
      [
        row("t-regra", { description: "Supermercado Extra" }),
        row("t-ia", { description: "Coisa estranha" }),
        row("t-pend", { description: "Outra coisa" }),
      ],
      { lowConfidenceIds: ["t-pend"] },
    );
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const all = ops();
    const guard = (id: string) => ({ id, workspaceId: "w1", categoryId: null, ignored: false, transferPairId: null });
    const rule = all.find((o) => o.op === "transaction.updateMany" && (o.args.where as Row).id === "t-regra")!;
    expect(rule.args.where).toEqual(guard("t-regra"));
    expect(rule.args.data).toMatchObject({ categoryId: "c-merc", categorySource: "rule", categoryConfidence: 1, reviewStatus: "ok", suggestedCategoryId: null });
    const aiHit = all.find((o) => o.op === "transaction.updateMany" && (o.args.where as Row).id === "t-ia")!;
    expect(aiHit.args.where).toEqual(guard("t-ia"));
    expect(aiHit.args.data).toMatchObject({ categoryId: "c-merc", categorySource: "ai", categoryConfidence: 0.95, reviewStatus: "ok" });
    const pend = all.find((o) => o.op === "transaction.updateMany" && (o.args.where as Row).id === "t-pend")!;
    expect(pend.args.where).toEqual(guard("t-pend"));
    expect(pend.args.data).toEqual({ reviewStatus: "pending", suggestedCategoryId: "c-merc", categoryConfidence: 0.5 });
    expect(all.some((o) => o.op === "transaction.update")).toBe(false);
    expect(all.find((o) => o.op === "categoryRule.updateMany")!.args).toEqual({ where: { id: "r1" }, data: { hitCount: { increment: 1 } } });
    const job = all.find((o) => o.op === "aiJob.update")!;
    expect(job.args.data).toMatchObject({ status: "done", costTokens: 7, result: { total: 3, transfers: 0, byRule: 1, byAi: 1, pending: 1, aiFailures: 0, deferred: 0 } });
  });

  it("categoria de fábrica (isSystem) é aplicada pela IA, mas Outras despesas fica pendente com sugestão", async () => {
    setup([row("t-merc", { description: "Coisa A" }), row("t-outras", { description: "Coisa B" })]);
    const ai = {
      categorizeBatch: vi.fn(async () => ({
        results: [
          { transactionId: "t-merc", categoryId: "c-merc", confidence: 0.95 },
          { transactionId: "t-outras", categoryId: "c-outras", confidence: 0.95 },
        ],
        costTokens: 1,
      })),
    };
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    const all = ops();
    const merc = all.find((o) => (o.args.where as Row).id === "t-merc")!;
    expect(merc.args.data).toMatchObject({ categoryId: "c-merc", categorySource: "ai", reviewStatus: "ok" });
    const outras = all.find((o) => (o.args.where as Row).id === "t-outras")!;
    expect(outras.args.data).toEqual({ reviewStatus: "pending", suggestedCategoryId: "c-outras", categoryConfidence: 0.95 });
    expect(all.find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ result: { byAi: 1, pending: 1 } });
  });

  it("falha da IA deixa pendente, sem sugestão, e o job termina done", async () => {
    const ai = setup([row("t1", { description: "Coisa estranha" })], { aiFails: true });
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    const pending = ops().find((o) => o.op === "transaction.updateMany")!;
    expect(pending.args.where).toEqual({ id: "t1", workspaceId: "w1", categoryId: null, ignored: false, transferPairId: null });
    expect(ops().some((o) => o.op === "transaction.update")).toBe(false);
    expect(pending.args.data).toEqual({ reviewStatus: "pending", suggestedCategoryId: null, categoryConfidence: null });
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ status: "done", result: { pending: 1, aiFailures: 1, deferred: 0 } });
  });

  it("pareia transferência usando os nomes do titular configurados", async () => {
    const saida = row("s", { description: "Pix para STAEL EDSON", accountId: "a-pj", account: { type: "checking", entity: "pj" } });
    const entrada = row("e", { type: "income", description: "Pix recebido", accountId: "a-pf" });
    const ai = setup([saida, entrada], {
      settings: { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] },
    });
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const pair = ops().find((o) => o.op === "transaction.updateMany")!;
    expect(pair.args.where).toEqual({ id: { in: ["s", "e"] }, workspaceId: "w1", transferPairId: null, ignored: false });
    expect(pair.args.data).toEqual({ transferPairId: expect.any(String), reviewStatus: "ok", suggestedCategoryId: null, categoryConfidence: null });
    expect(ops().some((o) => o.op === "transaction.update")).toBe(false);
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ result: { transfers: 1 } });
    expect(ai.categorizeBatch).not.toHaveBeenCalled();
  });

  it("par em que só uma linha foi gravada (count 1) é desfeito e não conta como transferência", async () => {
    const saida = row("s", { description: "Pix para STAEL EDSON", accountId: "a-pj", account: { type: "checking", entity: "pj" } });
    const entrada = row("e", { type: "income", description: "Pix recebido", accountId: "a-pf" });
    const ai = setup([saida, entrada], {
      settings: { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] },
    });
    db.countFor.fn = () => 1;
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const all = ops();
    const pairWrite = all.find((o) => o.op === "transaction.updateMany" && typeof o.args.where === "object" && "id" in (o.args.where as Row))!;
    const pairId = (pairWrite.args.data as { transferPairId: string }).transferPairId;
    const undo = all.filter((o) => o.op === "transaction.updateMany" && (o.args.where as Row).transferPairId === pairId);
    expect(undo).toHaveLength(2);
    expect(undo[0].args).toEqual({ where: { workspaceId: "w1", transferPairId: pairId, categoryId: null }, data: { reviewStatus: "pending" } });
    expect(undo[1].args).toEqual({ where: { workspaceId: "w1", transferPairId: pairId }, data: { transferPairId: null } });
    expect(all.find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ result: { transfers: 0 } });
  });

  it("par completo (count 2) não é desfeito", async () => {
    const saida = row("s", { description: "Pix para STAEL EDSON", accountId: "a-pj", account: { type: "checking", entity: "pj" } });
    const entrada = row("e", { type: "income", description: "Pix recebido", accountId: "a-pf" });
    const ai = setup([saida, entrada], {
      settings: { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] },
    });
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    expect(ops().filter((o) => o.op === "transaction.updateMany")).toHaveLength(1);
  });

  it("regra apagada no meio do job (updateMany count 0) não lança e hitCount/resultado só contam o que mudou", async () => {
    const ai = setup([
      row("t-regra", { description: "Supermercado Extra" }),
      row("t-regra2", { description: "Supermercado Bom" }),
      row("t-ia", { description: "Coisa estranha" }),
    ]);
    // t-regra2 já foi categorizada por outro caminho (guarda não casa): count 0.
    db.countFor.fn = (name, args) => (name === "categoryRule.updateMany" ? 0 : (args.where as { id?: unknown }).id === "t-regra2" ? 0 : 1);
    await expect(processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never })).resolves.toBeUndefined();

    const all = ops();
    expect(all.find((o) => o.op === "categoryRule.updateMany")!.args).toEqual({ where: { id: "r1" }, data: { hitCount: { increment: 1 } } });
    expect(all.find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({
      status: "done", result: { total: 3, transfers: 0, byRule: 1, byAi: 1, pending: 0 },
    });
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
      status: "done", result: { total: 0, transfers: 0, byRule: 0, byAi: 0, pending: 0, aiFailures: 0, deferred: 0 },
    });
  });

  it("a consulta do pool usa a janela min/max das datas do escopo mais/menos a tolerância configurada", async () => {
    const ai = setup(
      [row("t1", { date: new Date("2026-06-10") }), row("t2", { date: new Date("2026-06-20") })],
      { settings: { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 3, ownerNames: [] } },
    );
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    const poolCall = db.txFindMany.mock.calls.map((c) => c[0] as { where: Row }).find((a) => "date" in a.where)!;
    const win = poolCall.where["date"] as { gte: Date; lte: Date };
    expect(win.gte.toISOString()).toBe("2026-06-07T00:00:00.000Z");
    expect(win.lte.toISOString()).toBe("2026-06-23T00:00:00.000Z");
  });

  it("exemplos: ignora lançamentos ignorados/pareados, faz uma consulta sem filtro de entidade quando há conta nula e deduplica", async () => {
    const dup = { counterparty: null, description: "padaria do zé", category: { name: "Supermercado" }, account: { entity: "pf" } };
    const ai = setup(
      [row("t-pf", { description: "Coisa A" }), row("t-null", { description: "Coisa B", accountId: null, account: null })],
      {
        examples: [
          dup, dup,
          { counterparty: null, description: "nota fiscal cliente", category: { name: "Fornecedores" }, account: { entity: "pj" } },
        ],
      },
    );
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const exampleCalls = db.txFindMany.mock.calls
      .map((c) => c[0] as { where: Row })
      .filter((a) => typeof a.where["categorySource"] === "object");
    expect(exampleCalls).toHaveLength(1);
    expect(exampleCalls[0].where).not.toHaveProperty("account");
    expect(exampleCalls[0].where).toMatchObject({ ignored: false, transferPairId: null });

    const prompts = (ai.categorizeBatch.mock.calls as unknown as Array<[{ user: string }]>).map((c) => JSON.parse(c[0].user) as { examples: Array<{ descricao: string }>; transactions: Array<{ id: string }> });
    const pfPrompt = prompts.find((p) => p.transactions[0].id === "t-pf")!;
    const nullPrompt = prompts.find((p) => p.transactions[0].id === "t-null")!;
    expect(pfPrompt.examples.map((e) => e.descricao)).toEqual(["padaria do zé"]);
    expect(nullPrompt.examples.map((e) => e.descricao).sort()).toEqual(["nota fiscal cliente", "padaria do zé"]);
  });

  it("exemplos: sem conta nula faz uma consulta por entidade, filtrada pela entidade", async () => {
    const ai = setup([
      row("t-pf", { description: "Coisa A" }),
      row("t-pj", { description: "Coisa B", accountId: "a-pj", account: { type: "checking", entity: "pj" } }),
    ]);
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    const exampleCalls = db.txFindMany.mock.calls
      .map((c) => c[0] as { where: Row })
      .filter((a) => typeof a.where["categorySource"] === "object");
    expect(exampleCalls.map((a) => a.where["account"]).sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))).toEqual([
      { entity: "pf" }, { entity: "pj" },
    ]);
  });

  it("linhas além do teto de IA viram pendentes num único updateMany guardado (sem tocar na sugestão) e o job registra deferred", async () => {
    const rows = Array.from({ length: MAX_AI_ROWS_PER_JOB + 2 }, (_, i) =>
      row(`t${i}`, { description: "Coisa estranha", date: new Date(i < 2 ? "2026-01-05" : "2026-06-10") }));
    const ai = setup(rows);
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const all = ops();
    const deferredOps = all.filter((x) => x.op === "transaction.updateMany" && typeof (x.args.where as Row).id === "object");
    expect(deferredOps).toHaveLength(1);
    const where = deferredOps[0].args.where as { id: { in: string[] } };
    expect(where).toEqual({ id: { in: expect.any(Array) }, workspaceId: "w1", categoryId: null, ignored: false, transferPairId: null });
    expect(where.id.in.slice().sort()).toEqual(["t0", "t1"]);
    expect(deferredOps[0].args.data).toEqual({ reviewStatus: "pending" });
    const sent = (ai.categorizeBatch.mock.calls as unknown as Array<[{ user: string }]>).flatMap(([c]) => (JSON.parse(c.user).transactions as Array<{ id: string }>).map((t) => t.id));
    expect(sent).toHaveLength(MAX_AI_ROWS_PER_JOB);
    expect(sent).not.toContain("t0");
    expect(all.find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({
      status: "done", result: { total: MAX_AI_ROWS_PER_JOB + 2, byAi: MAX_AI_ROWS_PER_JOB, pending: 2, aiFailures: 0, deferred: 2 },
    });
  });
});
