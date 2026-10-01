import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { matchRule } from "@app/shared";

let app: NestFastifyApplication;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

async function newUser(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  return {
    userId: u!.user.id,
    workspaceId: ws.id,
    h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" },
  };
}
type User = Awaited<ReturnType<typeof newUser>>;

const account = (u: User, name: string, entity: "pf" | "pj", extra: Record<string, unknown> = {}) =>
  prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name, entity, ...extra } });

const category = (u: User, name: string, type: "income" | "expense", entity: "pf" | "pj" | "both" = "both") =>
  prisma.category.create({ data: { workspaceId: u.workspaceId, name, type, entity } });

let seq = 0;
function tx(u: User, accountId: string, over: Record<string, unknown> = {}) {
  return prisma.transaction.create({
    data: {
      workspaceId: u.workspaceId, type: "expense", amountCents: 1000n, date: new Date("2026-06-10"), accountId,
      description: "Compra", source: "import", createdById: u.userId, importFingerprint: `fp-${Date.now()}-${++seq}`,
      reviewStatus: "pending", ...over,
    } as never,
  });
}

const get = (u: User, url: string) => app.inject({ method: "GET", url, headers: u.h });
const post = (u: User, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });

describe("GET /review/pending", () => {
  it("agrupa por tipo e descrição normalizada, soma valores e escolhe a sugestão mais comum", async () => {
    const u = await newUser("rev1");
    const acc = await account(u, "Conta PF", "pf");
    const sug = await category(u, "Restaurantes", "expense");
    await tx(u, acc.id, { description: "iFood *Pedido 111", amountCents: 3000n, suggestedCategoryId: sug.id });
    await tx(u, acc.id, { description: "IFOOD pedido 222", amountCents: 2000n, suggestedCategoryId: sug.id });
    await tx(u, acc.id, { description: "Padaria", amountCents: 500n });
    await tx(u, acc.id, { description: "iFood Pedido", type: "income", amountCents: 100n });

    const res = await get(u, "/review/pending");
    expect(res.statusCode).toBe(200);
    const { total, groups } = res.json();
    expect(total).toBe(4);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ type: "expense", count: 2, totalCents: 5000, entity: "pf", suggestedCategoryId: sug.id });
    expect(groups[0].transactionIds).toHaveLength(2);
    expect(groups.map((g: { totalCents: number }) => g.totalCents)).toEqual([5000, 500, 100]);
  });

  it("não lista ignorados, pareados nem já revisados; filtra por entidade e conta", async () => {
    const u = await newUser("rev2");
    const pf = await account(u, "PF", "pf");
    const pj = await account(u, "PJ", "pj");
    await tx(u, pf.id, { description: "pendente pf" });
    await tx(u, pj.id, { description: "pendente pj" });
    await tx(u, pf.id, { description: "ignorado", ignored: true });
    await tx(u, pf.id, { description: "pareado", transferPairId: "p1" });
    await tx(u, pf.id, { description: "revisado", reviewStatus: "ok" });

    expect((await get(u, "/review/pending")).json().total).toBe(2);
    const onlyPj = (await get(u, "/review/pending?entity=pj")).json();
    expect(onlyPj.groups.map((g: { description: string }) => g.description)).toEqual(["pendente pj"]);
    const onlyAcc = (await get(u, `/review/pending?accountId=${pf.id}`)).json();
    expect(onlyAcc.total).toBe(1);
    expect((await get(u, "/review/pending?entity=xx")).statusCode).toBe(400);
  });

  it("é isolado por workspace", async () => {
    const a = await newUser("rev3a");
    const b = await newUser("rev3b");
    await tx(a, (await account(a, "PF", "pf")).id);
    expect((await get(b, "/review/pending")).json().total).toBe(0);
  });
});

describe("POST /review/categorize", () => {
  it("categoriza o grupo como manual, cria a regra e zera a revisão", async () => {
    const u = await newUser("cat1");
    const acc = await account(u, "PF", "pf");
    const merc = await category(u, "Supermercado", "expense");
    const t1 = await tx(u, acc.id, { description: "Mercado Bom 1", suggestedCategoryId: merc.id, categoryConfidence: 0.5 });
    const t2 = await tx(u, acc.id, { description: "Mercado Bom 2" });

    const res = await post(u, "/review/categorize", { transactionIds: [t1.id, t2.id], categoryId: merc.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, similarUpdated: 0, ruleCreated: true });

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: t1.id } });
    expect(after).toMatchObject({ categoryId: merc.id, categorySource: "manual", reviewStatus: "ok", suggestedCategoryId: null, categoryConfidence: null });

    const rules = (await get(u, "/category-rules")).json() as Array<{ categoryId: string; hitCount: number }>;
    expect(rules.find((r) => r.categoryId === merc.id)).toMatchObject({ hitCount: 0 });
  });

  it("createRule=false não cria regra", async () => {
    const u = await newUser("cat2");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Lazer", "expense");
    const t = await tx(u, acc.id, { description: "Cinema" });
    const res = await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: c.id, createRule: false });
    expect(res.json().ruleCreated).toBe(false);
    expect((await get(u, "/category-rules")).json()).toHaveLength(0);
  });

  it("regra de um Pix enviado não captura Pix para outro destinatário", async () => {
    const u = await newUser("cat-pix");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Padaria", "expense");
    const t = await tx(u, acc.id, { description: "Pix enviado para Padaria" });
    const res = await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: c.id, createRule: true });
    expect(res.json().ruleCreated).toBe(true);

    const rules = (await get(u, "/category-rules")).json() as Array<{ matchType: string; pattern: string }>;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ matchType: "contains", pattern: "padaria" });
    expect(matchRule("Pix enviado para Padaria 12/03", rules.map((r) => ({ ...r, categoryId: c.id, priority: 120 })) as never)).not.toBeNull();
    expect(matchRule("Pix enviado para Farmácia", rules.map((r) => ({ ...r, categoryId: c.id, priority: 120 })) as never)).toBeNull();
  });

  it("descrição só genérica (Pix enviado) não cria regra e ruleCreated é false", async () => {
    const u = await newUser("cat-gen");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Diversos g", "expense");
    const t = await tx(u, acc.id, { description: "Pix enviado" });
    const res = await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: c.id, createRule: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ updated: 1, ruleCreated: false });
    expect((await get(u, "/category-rules")).json()).toHaveLength(0);
  });

  it("applyToSimilar leva junto os pendentes de mesma descrição e tipo, sem tocar nos demais", async () => {
    const u = await newUser("cat3");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Assinaturas", "expense");
    const sel = await tx(u, acc.id, { description: "Netflix 01/2026" });
    const parecido = await tx(u, acc.id, { description: "NETFLIX 02/2026" });
    const semCategoria = await tx(u, acc.id, { description: "Netflix 03/2026", reviewStatus: "ok", categorySource: "none" });
    const outroTipo = await tx(u, acc.id, { description: "Netflix reembolso", type: "income" });
    const outraDesc = await tx(u, acc.id, { description: "Spotify" });
    const jaCategorizado = await tx(u, acc.id, { description: "Netflix 04/2026", reviewStatus: "ok", categorySource: "manual" });

    const res = await post(u, "/review/categorize", { transactionIds: [sel.id], categoryId: c.id, applyToSimilar: true });
    expect(res.json()).toMatchObject({ updated: 3, similarUpdated: 2 });

    const cat = async (id: string) => (await prisma.transaction.findUniqueOrThrow({ where: { id } })).categoryId;
    expect(await cat(parecido.id)).toBe(c.id);
    expect(await cat(semCategoria.id)).toBe(c.id);
    expect(await cat(outroTipo.id)).toBeNull();
    expect(await cat(outraDesc.id)).toBeNull();
    expect(await cat(jaCategorizado.id)).toBeNull();
  });

  it("recusa categoria de tipo errado ou de entidade errada (400) e categoria/lançamento de outro workspace (404)", async () => {
    const u = await newUser("cat4");
    const other = await newUser("cat4b");
    const acc = await account(u, "PF", "pf");
    const t = await tx(u, acc.id);
    const receita = await category(u, "Salário x", "income");
    const soPj = await category(u, "Fornecedores x", "expense", "pj");
    const alheia = await category(other, "Alheia", "expense");

    expect((await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: receita.id })).statusCode).toBe(400);
    expect((await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: soPj.id })).statusCode).toBe(400);
    expect((await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: alheia.id })).statusCode).toBe(404);
    expect((await post(other, "/review/categorize", { transactionIds: [t.id], categoryId: alheia.id })).statusCode).toBe(404);
    expect((await post(u, "/review/categorize", { transactionIds: [], categoryId: alheia.id })).statusCode).toBe(400);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBeNull();
  });
});

describe("POST /review/categorize (regra aprendida)", () => {
  it("aprende a regra do primeiro id listado, não de uma ordem arbitrária", async () => {
    const u = await newUser("cat5");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Mercado r", "expense");
    const t1 = await tx(u, acc.id, { description: "Alfa Loja" });
    const t2 = await tx(u, acc.id, { description: "Beta Loja" });
    const res = await post(u, "/review/categorize", { transactionIds: [t2.id, t1.id], categoryId: c.id });
    expect(res.statusCode).toBe(200);
    const rules = await prisma.categoryRule.findMany({ where: { workspaceId: u.workspaceId } });
    expect(rules.map((r) => r.pattern)).toEqual(["beta loja"]);
  });
});

describe("POST /review/accept-suggestion", () => {
  it("aplica a sugestão como ai e pula o que não tem sugestão ou ficou incompatível", async () => {
    const u = await newUser("acc1");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Transporte x", "expense");
    const incompat = await category(u, "Só PJ", "expense", "pj");
    const comSug = await tx(u, acc.id, { suggestedCategoryId: c.id, categoryConfidence: 0.6 });
    const semSug = await tx(u, acc.id);
    const incomp = await tx(u, acc.id, { suggestedCategoryId: incompat.id });

    const res = await post(u, "/review/accept-suggestion", { transactionIds: [comSug.id, semSug.id, incomp.id] });
    expect(res.json()).toEqual({ accepted: 1, skipped: 2 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: comSug.id } })).toMatchObject({
      categoryId: c.id, categorySource: "ai", reviewStatus: "ok", suggestedCategoryId: null, categoryConfidence: 0.6,
    });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: semSug.id } })).categoryId).toBeNull();
  });
});

describe("transferências e ignorar", () => {
  async function par(u: User) {
    const pj = await account(u, "PJ", "pj");
    const pf = await account(u, "PF", "pf");
    const saida = await tx(u, pj.id, { description: "Pix enviado", amountCents: 5000n });
    const entrada = await tx(u, pf.id, { description: "Pix recebido", type: "income", amountCents: 5000n });
    return { pj, pf, saida, entrada };
  }

  it("marca e desfaz o par de transferência", async () => {
    const u = await newUser("tr1");
    const { saida, entrada } = await par(u);
    const res = await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id });
    expect(res.statusCode).toBe(200);
    const { transferPairId } = res.json();
    const pair = await prisma.transaction.findMany({ where: { transferPairId } });
    expect(pair).toHaveLength(2);
    expect(pair.every((t) => t.reviewStatus === "ok")).toBe(true);
    expect((await get(u, "/review/pending")).json().total).toBe(0);

    const un = await post(u, "/review/unpair", { transferPairId });
    expect(un.json()).toEqual({ unpaired: 2 });
    const back = await prisma.transaction.findUniqueOrThrow({ where: { id: saida.id } });
    expect(back).toMatchObject({ transferPairId: null, reviewStatus: "pending", categorySource: "none" });
  });

  it("recusa par inválido (mesma conta, mesmo sentido, valor diferente, já pareado) e lançamento alheio", async () => {
    const u = await newUser("tr2");
    const other = await newUser("tr2b");
    const { pj, saida, entrada } = await par(u);
    const mesmaConta = await tx(u, pj.id, { type: "income", amountCents: 5000n });
    const mesmoSentido = await tx(u, (await account(u, "Outra", "pf")).id, { amountCents: 5000n });
    const valor = await tx(u, (await account(u, "Outra2", "pf")).id, { type: "income", amountCents: 4999n });

    const bad = async (other: string) => (await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: other })).statusCode;
    expect(await bad(mesmaConta.id)).toBe(400);
    expect(await bad(mesmoSentido.id)).toBe(400);
    expect(await bad(valor.id)).toBe(400);
    expect((await post(other, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id })).statusCode).toBe(404);

    expect((await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id })).statusCode).toBe(200);
    expect(await bad(entrada.id)).toBe(400); // já pareados
  });

  it("lista as contrapartes possíveis", async () => {
    const u = await newUser("tr3");
    const { saida, entrada } = await par(u);
    await tx(u, (await account(u, "X", "pf")).id, { type: "income", amountCents: 5000n, date: new Date("2026-07-20"), description: "longe" });
    const res = await get(u, `/review/transfer-candidates?transactionId=${saida.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { id: string }) => c.id)).toEqual([entrada.id]);
    expect(res.json()[0]).toMatchObject({ accountName: "PF", amountCents: 5000, description: "Pix recebido" });
  });

  it("ignora lançamentos: saem da fila e ficam marcados", async () => {
    const u = await newUser("ign1");
    const acc = await account(u, "PF", "pf");
    const t = await tx(u, acc.id);
    const res = await post(u, "/review/ignore", { transactionIds: [t.id] });
    expect(res.json()).toEqual({ ignored: 1 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ ignored: true, reviewStatus: "ok" });
    expect((await get(u, "/review/pending")).json().total).toBe(0);
  });

  it("desfazer par: sem categoria volta para a fila; com categoria só perde o par", async () => {
    const u = await newUser("tr4");
    const pj = await account(u, "PJ", "pj");
    const pf = await account(u, "PF", "pf");
    const c = await category(u, "Categoria par", "expense");
    const semCat = await tx(u, pj.id, { transferPairId: "pair-x", reviewStatus: "ok" });
    const comCat = await tx(u, pf.id, { transferPairId: "pair-x", reviewStatus: "ok", categoryId: c.id, categorySource: "manual", type: "income" });
    const res = await post(u, "/review/unpair", { transferPairId: "pair-x" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unpaired: 2 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: semCat.id } })).toMatchObject({ transferPairId: null, reviewStatus: "pending", categorySource: "none", categoryId: null });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: comCat.id } })).toMatchObject({ transferPairId: null, reviewStatus: "ok", categorySource: "manual", categoryId: c.id });
    expect((await post(u, "/review/unpair", { transferPairId: "pair-x" })).statusCode).toBe(404);
  });

  it("marcar limpa sugestão e confiança do par", async () => {
    const u = await newUser("tr5");
    const { saida, entrada } = await par(u);
    const c = await category(u, "Sug par", "expense");
    await prisma.transaction.update({ where: { id: saida.id }, data: { suggestedCategoryId: c.id, categoryConfidence: 0.7 } });
    expect((await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id })).statusCode).toBe(200);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: saida.id } })).toMatchObject({ suggestedCategoryId: null, categoryConfidence: null, reviewStatus: "ok" });
  });

  it("recusa marcar lançamento ignorado (400)", async () => {
    const u = await newUser("tr6");
    const { saida, entrada } = await par(u);
    await prisma.transaction.update({ where: { id: entrada.id }, data: { ignored: true } });
    expect((await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id })).statusCode).toBe(400);
    expect((await post(u, "/review/mark-transfer", { transactionId: entrada.id, counterpartTransactionId: saida.id })).statusCode).toBe(400);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: saida.id } })).transferPairId).toBeNull();
  });

  it("duas marcações concorrentes do mesmo lançamento: só uma vence e nenhum par fica pela metade", async () => {
    const u = await newUser("tr7");
    const pj = await account(u, "PJ", "pj");
    const pf = await account(u, "PF", "pf");
    const pf2 = await account(u, "PF2", "pf");
    for (let round = 0; round < 5; round++) {
      const saida = await tx(u, pj.id, { amountCents: 7000n + BigInt(round), description: `Saída ${round}` });
      const e1 = await tx(u, pf.id, { type: "income", amountCents: 7000n + BigInt(round) });
      const e2 = await tx(u, pf2.id, { type: "income", amountCents: 7000n + BigInt(round) });
      const [r1, r2] = await Promise.all([
        post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: e1.id }),
        post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: e2.id }),
      ]);
      const codes = [r1.statusCode, r2.statusCode].sort();
      expect(codes[0]).toBe(200);
      expect([400, 409]).toContain(codes[1]);
      const rows = await prisma.transaction.findMany({ where: { id: { in: [saida.id, e1.id, e2.id] } } });
      const paired = rows.filter((r) => r.transferPairId);
      expect(paired).toHaveLength(2);
      expect(new Set(paired.map((r) => r.transferPairId)).size).toBe(1);
    }
  });

  it("transfer-candidates exige conta no lançamento de origem (400)", async () => {
    const u = await newUser("tr8");
    const semConta = await tx(u, null as never, { accountId: null });
    expect((await get(u, `/review/transfer-candidates?transactionId=${semConta.id}`)).statusCode).toBe(400);
  });

  it("isolamento: outro workspace não aceita sugestão, ignora, desfaz par nem lista candidatos", async () => {
    const u = await newUser("iso1");
    const other = await newUser("iso1b");
    const c = await category(u, "Iso cat", "expense");
    const pj = await account(u, "PJ", "pj");
    const pf = await account(u, "PF", "pf");
    const comSug = await tx(u, pj.id, { suggestedCategoryId: c.id, description: "Sug iso" });
    const a = await tx(u, pj.id, { transferPairId: "pair-iso", reviewStatus: "ok", amountCents: 900n });
    const b = await tx(u, pf.id, { transferPairId: "pair-iso", reviewStatus: "ok", amountCents: 900n, type: "income" });
    const fonte = await tx(u, pj.id, { amountCents: 123n });
    await tx(u, pf.id, { amountCents: 123n, type: "income" });

    expect((await post(other, "/review/accept-suggestion", { transactionIds: [comSug.id] })).json()).toEqual({ accepted: 0, skipped: 1 });
    expect((await post(other, "/review/ignore", { transactionIds: [comSug.id] })).json()).toEqual({ ignored: 0 });
    expect((await post(other, "/review/unpair", { transferPairId: "pair-iso" })).statusCode).toBe(404);
    expect((await get(other, `/review/transfer-candidates?transactionId=${fonte.id}`)).statusCode).toBe(404);

    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: comSug.id } })).toMatchObject({ categoryId: null, ignored: false, reviewStatus: "pending", suggestedCategoryId: c.id });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ transferPairId: "pair-iso", reviewStatus: "ok" });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: b.id } })).transferPairId).toBe("pair-iso");
  });

  it("recategorize enfileira um job categorize sem lote", async () => {
    const u = await newUser("rec1");
    const res = await post(u, "/review/recategorize");
    expect(res.statusCode).toBe(201);
    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(job).toMatchObject({ kind: "categorize", inputRef: null, workspaceId: u.workspaceId });
  });
});

describe("PATCH /transactions/:id/category", () => {
  const patch = (u: User, id: string, payload: unknown) => app.inject({ method: "PATCH", url: `/transactions/${id}/category`, headers: u.h, payload: payload as object });

  it("grava como manual, zera a revisão e devolve similarCount", async () => {
    const u = await newUser("pat1");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Assinaturas p", "expense");
    const t = await tx(u, acc.id, { description: "Disney 1" });
    await tx(u, acc.id, { description: "Disney 2" });
    const res = await patch(u, t.id, { categoryId: c.id, applyToSimilar: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: t.id, categoryId: c.id, similarCount: 1 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ categorySource: "manual", reviewStatus: "ok" });
    expect((await prisma.transaction.count({ where: { workspaceId: u.workspaceId, categoryId: c.id } }))).toBe(2);
  });

  it("categoryId nulo volta para sem categoria; categoria incompatível retorna 400", async () => {
    const u = await newUser("pat2");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Lazer p", "expense");
    const receita = await category(u, "Salário p", "income");
    const t = await tx(u, acc.id, { categoryId: c.id, categorySource: "manual", reviewStatus: "ok" });

    expect((await patch(u, t.id, { categoryId: receita.id })).statusCode).toBe(400);
    const res = await patch(u, t.id, { categoryId: null });
    expect(res.statusCode).toBe(200);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      categoryId: null, categorySource: "none", categoryConfidence: null, suggestedCategoryId: null, reviewStatus: "pending",
    });
  });

  it("recusa corpo inválido (400) sem alterar o lançamento nem criar regra; categoryId nulo segue funcionando", async () => {
    const u = await newUser("pat3");
    const acc = await account(u, "PF", "pf");
    await category(u, "Qualquer p", "expense");
    const t = await tx(u, acc.id, { description: "Corpo ruim" });
    const bodies: unknown[] = [{}, { applyToSimilar: true }, { categoryId: 123 }, { categoryId: "" }, { categoryId: "x", applyToSimilar: "sim" }];
    for (const b of bodies) {
      expect((await patch(u, t.id, b)).statusCode, JSON.stringify(b)).toBe(400);
    }
    const semCorpo = await app.inject({ method: "PATCH", url: `/transactions/${t.id}/category`, headers: { authorization: u.h.authorization } });
    expect(semCorpo.statusCode).toBe(400);
    const corpoVazioJson = await app.inject({ method: "PATCH", url: `/transactions/${t.id}/category`, headers: u.h });
    expect(corpoVazioJson.statusCode).toBe(400);

    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ categoryId: null, categorySource: "none", reviewStatus: "pending" });
    expect(await prisma.categoryRule.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
    expect((await patch(u, t.id, { categoryId: null })).statusCode).toBe(200);
  });

  it("applyToSimilar nunca toca pendentes de outro workspace com a mesma descrição", async () => {
    const u = await newUser("pat4");
    const other = await newUser("pat4b");
    const c = await category(u, "Assinaturas iso", "expense");
    const mine = await tx(u, (await account(u, "PF", "pf")).id, { description: "Hulu 1" });
    const theirs = await tx(other, (await account(other, "PF", "pf")).id, { description: "Hulu 2" });
    const res = await patch(u, mine.id, { categoryId: c.id, applyToSimilar: true });
    expect(res.json().similarCount).toBe(0);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({ categoryId: null, reviewStatus: "pending" });
  });
});

describe("lançamentos sem chave de descrição (só dígitos/pontuação)", () => {
  it("applyToSimilar não agrupa chaves vazias entre si, mas atualiza os selecionados", async () => {
    const u = await newUser("empty1");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Diversos e", "expense");
    const a = await tx(u, acc.id, { description: "000123" });
    const b = await tx(u, acc.id, { description: "***" });

    const res = await post(u, "/review/categorize", { transactionIds: [a.id], categoryId: c.id, applyToSimilar: true, createRule: false });
    expect(res.json()).toMatchObject({ updated: 1, similarUpdated: 0 });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: a.id } })).categoryId).toBe(c.id);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: b.id } })).categoryId).toBeNull();
  });

  it("a fila agrupa esses lançamentos sob '(sem descrição)' mantendo o texto cru no grupo", async () => {
    const u = await newUser("empty2");
    const acc = await account(u, "PF", "pf");
    await tx(u, acc.id, { description: "000123", amountCents: 700n });
    await tx(u, acc.id, { description: "***", amountCents: 300n });
    const { groups } = (await get(u, "/review/pending")).json();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "expense|(sem descrição)", description: "000123", count: 2, totalCents: 1000 });
  });
});

describe("POST /category-rules valida o padrão", () => {
  it("regex inválida e padrão vazio retornam 400; regex válida e demais tipos funcionam", async () => {
    const u = await newUser("rule1");
    const c = await category(u, "Regras r", "expense");
    const rule = (matchType: string, pattern: string) => post(u, "/category-rules", { matchType, pattern, categoryId: c.id });

    expect((await rule("regex", "([a-z")).statusCode).toBe(400);
    expect((await rule("regex", "^uber\\s+trip$")).statusCode).toBe(201);
    expect((await rule("contains", "mercado")).statusCode).toBe(201);
    expect((await rule("equals", "padaria")).statusCode).toBe(201);
    expect((await rule("contains", "   ")).statusCode).toBe(400);
    expect((await rule("regex", "")).statusCode).toBe(400);
    expect((await get(u, "/category-rules")).json()).toHaveLength(3);
  });
});

describe("POST /category-rules: padrão aparado e limitado", () => {
  it("grava o padrão aparado e recusa mais de 200 caracteres em qualquer tipo", async () => {
    const u = await newUser("rule2");
    const c = await category(u, "Regras t", "expense");
    const rule = (matchType: string, pattern: string) => post(u, "/category-rules", { matchType, pattern, categoryId: c.id });

    expect((await rule("contains", "  padaria  ")).statusCode).toBe(201);
    expect((await rule("regex", "  ^uber  ")).statusCode).toBe(201);
    expect((await get(u, "/category-rules")).json().map((r: { pattern: string }) => r.pattern).sort()).toEqual(["^uber", "padaria"]);
    expect((await rule("contains", "a".repeat(200))).statusCode).toBe(201);
    for (const t of ["contains", "equals", "regex"]) {
      expect((await rule(t, "a".repeat(201))).statusCode, t).toBe(400);
    }
    expect((await rule("contains", `  ${"b".repeat(201)}  `)).statusCode).toBe(400);
  });
});

describe("remoção de categoria", () => {
  it("devolve os lançamentos da categoria removida para a fila de revisão", async () => {
    const u = await newUser("del1");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Temporária", "expense");
    const t = await tx(u, acc.id, { description: "Algo", categoryId: c.id, categorySource: "manual", reviewStatus: "ok" });
    expect((await get(u, "/review/pending")).json().total).toBe(0);

    const res = await app.inject({ method: "DELETE", url: `/categories/${c.id}`, headers: { authorization: u.h.authorization } });
    expect(res.statusCode).toBe(204);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({
      categoryId: null, categorySource: "none", categoryConfidence: null, reviewStatus: "pending",
    });
    const pending = (await get(u, "/review/pending")).json();
    expect(pending.total).toBe(1);
    expect(pending.groups[0].transactionIds).toEqual([t.id]);
  });
});

