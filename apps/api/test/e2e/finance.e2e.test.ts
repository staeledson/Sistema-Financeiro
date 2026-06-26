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

describe("Fase 1 — Núcleo Financeiro", () => {
  it("T2: cria, lista e arquiva conta bancária", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t2_${ts}@test.com`, password: "senha123!", name: "T2" } });
    const auth_h = { authorization: `Bearer ${u!.token}` };
    const json_h = { ...auth_h, "content-type": "application/json" };

    const created = await app.inject({ method: "POST", url: "/accounts", headers: json_h, payload: { type: "checking", name: "Nubank", openingBalanceCents: 10000 } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    let list = await app.inject({ method: "GET", url: "/accounts", headers: auth_h });
    expect(list.json()).toHaveLength(1);

    const arch = await app.inject({ method: "PATCH", url: `/accounts/${id}/archive`, headers: auth_h });
    expect(arch.statusCode).toBe(200);

    list = await app.inject({ method: "GET", url: "/accounts", headers: auth_h });
    expect(list.json()).toHaveLength(0);
  });

  it("T3: novo usuário recebe 5 receitas e 15 despesas como categorias", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t3_${ts}@test.com`, password: "senha123!", name: "T3" } });
    const h = { authorization: `Bearer ${u!.token}` };

    const list = await app.inject({ method: "GET", url: "/categories", headers: h });
    const cats = list.json() as Array<{ type: string; isSystem: boolean }>;
    const income = cats.filter((c) => c.type === "income");
    const expense = cats.filter((c) => c.type === "expense");
    expect(income).toHaveLength(5);
    expect(expense).toHaveLength(15);
    expect(cats.every((c) => c.isSystem)).toBe(true);
  });

  it("T3: categorias isoladas entre workspaces", async () => {
    const ts = Date.now();
    const a = await auth.api.signUpEmail({ body: { email: `t3a_${ts}@test.com`, password: "senha123!", name: "A" } });
    const b = await auth.api.signUpEmail({ body: { email: `t3b_${ts}@test.com`, password: "senha123!", name: "B" } });

    const aList = await app.inject({ method: "GET", url: "/categories", headers: { authorization: `Bearer ${a!.token}` } });
    const bList = await app.inject({ method: "GET", url: "/categories", headers: { authorization: `Bearer ${b!.token}` } });
    const aIds = new Set(aList.json().map((c: { id: string }) => c.id));
    expect(bList.json().some((c: { id: string }) => aIds.has(c.id))).toBe(false);
  });

  it("T4: cria e lista tag", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t4_${ts}@test.com`, password: "senha123!", name: "T4" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const created = await app.inject({ method: "POST", url: "/tags", headers: h, payload: { name: "viagem" } });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/tags", headers: h });
    expect(list.json().map((t: { name: string }) => t.name)).toContain("viagem");
  });

  it("T5: cria transação de despesa e lista com filtros", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t5_${ts}@test.com`, password: "senha123!", name: "T5" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const acc = await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "checking", name: "C1" } });
    const accId = acc.json().id;

    const catList = await app.inject({ method: "GET", url: "/categories?type=expense", headers: h });
    const catId = catList.json()[0].id;

    const tx = await app.inject({ method: "POST", url: "/transactions", headers: h, payload: {
      type: "expense", amountCents: 5000, date: "2026-06-01", accountId: accId, categoryId: catId,
    }});
    expect(tx.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/transactions?from=2026-06-01&to=2026-06-30", headers: h });
    expect(list.json()).toHaveLength(1);

    const listOut = await app.inject({ method: "GET", url: "/transactions?from=2026-07-01&to=2026-07-31", headers: h });
    expect(listOut.json()).toHaveLength(0);
  });

  it("T5: rejeita transação com categoria errada", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t5b_${ts}@test.com`, password: "senha123!", name: "T5b" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const acc = await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "checking", name: "C1" } });
    const accId = acc.json().id;

    const catList = await app.inject({ method: "GET", url: "/categories?type=income", headers: h });
    const incomeCatId = catList.json()[0].id;

    const tx = await app.inject({ method: "POST", url: "/transactions", headers: h, payload: {
      type: "expense", amountCents: 1000, date: "2026-06-01", accountId: accId, categoryId: incomeCatId,
    }});
    expect(tx.statusCode).toBe(400);
  });

  it("T6: saldos batem e transferência é neutra no consolidado", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t6_${ts}@test.com`, password: "senha123!", name: "T6" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const c1 = (await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "checking", name: "C1", openingBalanceCents: 10000 } })).json().id;
    const c2 = (await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "savings", name: "C2", openingBalanceCents: 0 } })).json().id;

    const catList = await app.inject({ method: "GET", url: "/categories?type=expense", headers: h });
    const catId = catList.json()[0].id;

    await app.inject({ method: "POST", url: "/transactions", headers: h, payload: { type: "income",  amountCents: 20000, date: "2026-06-01", accountId: c1 } });
    await app.inject({ method: "POST", url: "/transactions", headers: h, payload: { type: "expense", amountCents: 5000,  date: "2026-06-02", accountId: c1, categoryId: catId } });
    await app.inject({ method: "POST", url: "/transactions", headers: h, payload: { type: "transfer", amountCents: 3000, date: "2026-06-03", sourceAccountId: c1, destAccountId: c2 } });

    const bal = await app.inject({ method: "GET", url: "/balances", headers: h });
    const { accounts, consolidatedCents } = bal.json();
    const byId = Object.fromEntries(accounts.map((a: { accountId: string; balanceCents: number }) => [a.accountId, a.balanceCents]));

    // C1: 10000 +20000 -5000 -3000 = 22000 ; C2: 0 +3000 = 3000
    expect(byId[c1]).toBe(22000);
    expect(byId[c2]).toBe(3000);
    expect(consolidatedCents).toBe(25000);
  });

  it("T7: dashboard retorna cashflow do mês excluindo transferências", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t7_${ts}@test.com`, password: "senha123!", name: "T7" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const c1 = (await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "checking", name: "C1" } })).json().id;
    const c2 = (await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "savings",  name: "C2" } })).json().id;
    const catId = ((await app.inject({ method: "GET", url: "/categories?type=expense", headers: h })).json() as Array<{id:string}>)[0].id;

    await app.inject({ method: "POST", url: "/transactions", headers: h, payload: { type: "income",   amountCents: 30000, date: "2026-06-01", accountId: c1 } });
    await app.inject({ method: "POST", url: "/transactions", headers: h, payload: { type: "expense",  amountCents: 8000,  date: "2026-06-01", accountId: c1, categoryId: catId } });
    await app.inject({ method: "POST", url: "/transactions", headers: h, payload: { type: "transfer", amountCents: 5000,  date: "2026-06-01", sourceAccountId: c1, destAccountId: c2 } });

    const dash = await app.inject({ method: "GET", url: "/dashboard?month=2026-06", headers: h });
    const { cashflow } = dash.json();
    expect(cashflow.incomeCents).toBe(30000);
    expect(cashflow.expenseCents).toBe(8000);
  });
});
