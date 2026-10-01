import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { WorkspaceSettingsService } from "../../src/workspaces/workspace-settings.service";

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
  return { userId: u!.user.id, workspaceId: ws.id, h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" } };
}
type User = Awaited<ReturnType<typeof newUser>>;

const post = (u: User, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });
const account = (u: User, name = "Conta") => prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name } });
const category = (u: User, name: string, type: "income" | "expense" = "expense") =>
  prisma.category.create({ data: { workspaceId: u.workspaceId, name, type } });

function batch(u: User, accountId: string, data: Record<string, unknown> = {}) {
  return prisma.importBatch.create({
    data: { workspaceId: u.workspaceId, accountId, format: "csv", status: "preview", createdById: u.userId, ...data } as never,
    select: { id: true },
  });
}

const row = (accountId: string, fp: string, extra: Record<string, unknown> = {}) => ({
  type: "expense", amountCents: 1000, date: "2026-06-10", accountId, description: "x", fingerprint: fp, ...extra,
});

describe("categorySource nas gravações", () => {
  it("lançamento manual com categoria é manual; sem categoria é none", async () => {
    const u = await newUser("src1");
    const acc = await account(u);
    const cat = await category(u, "Lazer");
    const com = await post(u, "/transactions", { type: "expense", amountCents: 100, date: "2026-06-01", accountId: acc.id, categoryId: cat.id });
    const sem = await post(u, "/transactions", { type: "expense", amountCents: 100, date: "2026-06-01", accountId: acc.id });
    expect(com.statusCode).toBe(201);
    const find = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect((await find(com.json().id)).categorySource).toBe("manual");
    expect((await find(sem.json().id)).categorySource).toBe("none");
  });

  it("importação: linha com categoryId é import; sem categoria é none", async () => {
    const u = await newUser("src2");
    const acc = await account(u);
    const cat = await category(u, "Mercado");
    const b = await batch(u, acc.id);
    const res = await post(u, `/import/${b.id}/commit`, {
      rows: [row(acc.id, "a", { categoryId: cat.id }), row(acc.id, "b")],
    });
    expect(res.json()).toEqual({ inserted: 2, skipped: 0 });
    const txs = await prisma.transaction.findMany({ where: { workspaceId: u.workspaceId }, orderBy: { importFingerprint: "asc" } });
    expect(txs.map((t) => t.categorySource)).toEqual(["import", "none"]);
  });

  it("rascunho confirmado com categoria vira manual", async () => {
    const u = await newUser("src3");
    const acc = await account(u);
    const cat = await category(u, "Saúde");
    const job = await prisma.aiJob.create({ data: { workspaceId: u.workspaceId, kind: "parse_text", createdById: u.userId } });
    const draft = await prisma.transactionDraft.create({
      data: {
        workspaceId: u.workspaceId, aiJobId: job.id, kind: "parse_text", type: "expense", amountCents: 500n,
        date: new Date("2026-06-02"), description: "Farmácia", categoryId: cat.id, createdById: u.userId,
      },
    });
    const res = await post(u, `/drafts/${draft.id}/confirm`, { accountId: acc.id });
    expect(res.statusCode).toBe(201);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: res.json().id } })).categorySource).toBe("manual");
  });
});

describe("commit da importação", () => {
  it("recusa categoryId de outro workspace (400) sem gravar nada", async () => {
    const a = await newUser("com1a");
    const b = await newUser("com1b");
    const acc = await account(a);
    const alheia = await category(b, "Alheia");
    const bt = await batch(a, acc.id);
    const res = await post(a, `/import/${bt.id}/commit`, { rows: [row(acc.id, "a", { categoryId: alheia.id })] });
    expect(res.statusCode).toBe(400);
    expect(await prisma.transaction.count({ where: { workspaceId: a.workspaceId } })).toBe(0);
  });

  it("commit e desfazer simultâneos nunca deixam linhas num lote desfeito", async () => {
    for (let i = 0; i < 8; i++) {
      const u = await newUser(`race${i}`);
      const acc = await account(u);
      const b = await batch(u, acc.id, { status: "committed" });
      await prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", amountCents: 1n, date: new Date("2026-06-01"), accountId: acc.id, source: "import", createdById: u.userId, importBatchId: b.id, importFingerprint: `seed-${i}` },
      });
      await Promise.all([
        post(u, `/import/${b.id}/undo`),
        post(u, `/import/${b.id}/commit`, { rows: [row(acc.id, `new-${i}`)] }),
      ]);
      const after = await prisma.importBatch.findUniqueOrThrow({ where: { id: b.id } });
      const count = await prisma.transaction.count({ where: { importBatchId: b.id } });
      if (after.undoneAt) expect(count).toBe(0);
    }
  });
});

describe("desfazer lote e pares de transferência", () => {
  it("solta o par das contrapartes que não são do lote", async () => {
    const u = await newUser("undo1");
    const pj = await account(u, "PJ");
    const pf = await account(u, "PF");
    const b = await batch(u, pj.id, { status: "committed" });
    const make = (accountId: string, extra: Record<string, unknown>) =>
      prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", amountCents: 5000n, date: new Date("2026-06-10"), accountId, source: "import", createdById: u.userId, transferPairId: "par-1", reviewStatus: "ok", ...extra } as never,
      });
    await make(pj.id, { importBatchId: b.id, importFingerprint: "in-batch" });
    const fora = await make(pf.id, { type: "income", importFingerprint: "outside" });

    const res = await post(u, `/import/${b.id}/undo`);
    expect(res.json()).toEqual({ removed: 1 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: fora.id } })).toMatchObject({
      transferPairId: null, reviewStatus: "pending", categorySource: "none",
    });
  });

  it("contraparte já categorizada mantém categoria, origem e status; só perde o par", async () => {
    const u = await newUser("undo2");
    const pj = await account(u, "PJ");
    const pf = await account(u, "PF");
    const cat = await category(u, "Aluguel");
    const b = await batch(u, pj.id, { status: "committed" });
    const make = (accountId: string, extra: Record<string, unknown>) =>
      prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", amountCents: 5000n, date: new Date("2026-06-10"), accountId, source: "import", createdById: u.userId, transferPairId: "par-2", reviewStatus: "ok", ...extra } as never,
      });
    await make(pj.id, { importBatchId: b.id, importFingerprint: "in-batch-2" });
    const fora = await make(pf.id, { type: "income", importFingerprint: "outside-2", categoryId: cat.id, categorySource: "manual" });

    const res = await post(u, `/import/${b.id}/undo`);
    expect(res.json()).toEqual({ removed: 1 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: fora.id } })).toMatchObject({
      transferPairId: null, categoryId: cat.id, categorySource: "manual", reviewStatus: "ok",
    });
  });

  it("contraparte em outro lote também é solta; a linha do lote desfeito é apagada", async () => {
    const u = await newUser("undo3");
    const pj = await account(u, "PJ");
    const pf = await account(u, "PF");
    const b = await batch(u, pj.id, { status: "committed" });
    const outro = await batch(u, pf.id, { status: "committed" });
    const make = (accountId: string, extra: Record<string, unknown>) =>
      prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", amountCents: 5000n, date: new Date("2026-06-10"), accountId, source: "import", createdById: u.userId, transferPairId: "par-3", reviewStatus: "ok", ...extra } as never,
      });
    const dentro = await make(pj.id, { importBatchId: b.id, importFingerprint: "in-batch-3" });
    const fora = await make(pf.id, { type: "income", importBatchId: outro.id, importFingerprint: "other-batch-3" });

    const res = await post(u, `/import/${b.id}/undo`);
    expect(res.json()).toEqual({ removed: 1 });
    expect(await prisma.transaction.findUnique({ where: { id: dentro.id } })).toBeNull();
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: fora.id } })).toMatchObject({
      transferPairId: null, reviewStatus: "pending", categorySource: "none", importBatchId: outro.id,
    });
  });
});

describe("OFX malformado e settings", () => {
  it("preview de OFX sem data válida retorna 422", async () => {
    const u = await newUser("ofx1");
    const acc = await account(u);
    const ofx = "<OFX><BANKACCTFROM><ACCTID>1</BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNAMT>-10.00<FITID>1<MEMO>x</STMTTRN></BANKTRANLIST></OFX>";
    const res = await post(u, "/import/preview", { accountId: acc.id, text: ofx, format: "ofx" });
    expect(res.statusCode).toBe(422);
  });

  it("GET /workspaces/current/settings não cria linha; PATCH cria", async () => {
    const u = await newUser("set1");
    const get = () => app.inject({ method: "GET", url: "/workspaces/current/settings", headers: u.h });
    expect((await get()).json()).toEqual({ aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: [] });
    expect(await prisma.workspaceSettings.count({ where: { workspaceId: u.workspaceId } })).toBe(0);

    await app.inject({ method: "PATCH", url: "/workspaces/current/settings", headers: u.h, payload: { aiBatchSize: 10 } });
    expect(await prisma.workspaceSettings.count({ where: { workspaceId: u.workspaceId } })).toBe(1);
    expect((await get()).json().aiBatchSize).toBe(10);
  });

  it("o serviço não expõe a constante de padrões: mutar a resposta não afeta a próxima", async () => {
    const u = await newUser("set2");
    const svc = app.get(WorkspaceSettingsService);
    const first = await svc.get(u.workspaceId);
    first.ownerNames.push("Fulano");
    const second = await svc.get(u.workspaceId);
    expect(second.ownerNames).toEqual([]);
  });
});
