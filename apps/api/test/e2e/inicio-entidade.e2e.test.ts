import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";

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

async function seed() {
  const u = await auth.api.signUpEmail({ body: { email: `ini_${Date.now()}@test.com`, password: "senha123!", name: "ini" } });
  const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
  const pf = await prisma.bankAccount.create({ data: { workspaceId: ws!.id, type: "checking", name: "PF", entity: "pf" } });
  const pj = await prisma.bankAccount.create({ data: { workspaceId: ws!.id, type: "checking", name: "PJ", entity: "pj" } });
  const base = { workspaceId: ws!.id, createdById: u!.user.id, type: "expense" as const, date: new Date("2026-09-10") };
  await prisma.transaction.create({ data: { ...base, amountCents: 100000, accountId: pf.id, description: "pf1" } });
  await prisma.transaction.create({ data: { ...base, amountCents: 50000, accountId: pf.id, description: "pf2", ignored: true } });
  await prisma.transaction.create({ data: { ...base, amountCents: 300000, accountId: pj.id, description: "pj1" } });
  await prisma.transaction.create({ data: { ...base, amountCents: 70000, accountId: pj.id, description: "pj2", transferPairId: "p" } });
  return { h: { authorization: `Bearer ${u!.token}` } };
}

const get = (h: Record<string, string>, qs: string) => app.inject({ method: "GET", url: `/dashboard/summary?asOf=2026-09-30&month=2026-09${qs}`, headers: h });

describe("GET /dashboard/summary com entity (só os gastos)", () => {
  it("sem entity: total do workspace e a divisão PF/PJ (sem ignorados nem pares)", async () => {
    const { h } = await seed();
    const b = (await get(h, "")).json();
    expect(b.spending.totalCents).toBe(400000);
    expect(b.spending.byEntity).toEqual({ pfCents: 100000, pjCents: 300000 });
  });

  it("entity=pj filtra os gastos, mas a divisão continua mostrando os dois lados", async () => {
    const { h } = await seed();
    const b = (await get(h, "&entity=pj")).json();
    expect(b.spending.totalCents).toBe(300000);
    expect(b.spending.byCategory.reduce((s: number, c: { totalCents: number }) => s + c.totalCents, 0)).toBe(300000);
    expect(b.spending.byEntity).toEqual({ pfCents: 100000, pjCents: 300000 });
    const pf = (await get(h, "&entity=pf")).json();
    expect(pf.spending.totalCents).toBe(100000);
  });

  it("os saldos continuam do workspace inteiro e entity inválida dá 400", async () => {
    const { h } = await seed();
    const all = (await get(h, "")).json();
    const pj = (await get(h, "&entity=pj")).json();
    expect(pj.balances).toEqual(all.balances);
    expect((await get(h, "&entity=xyz")).statusCode).toBe(400);
  });
});
