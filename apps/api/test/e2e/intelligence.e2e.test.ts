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

async function seed(tag: string) {
  const ts = Date.now();
  const u = await auth.api.signUpEmail({
    body: { email: `${tag}_${ts}@test.com`, password: "senha123!", name: tag },
  });
  const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
  const cat = await prisma.category.create({
    data: { workspaceId: ws!.id, name: "Alimentação", type: "expense" },
  });
  const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };
  return { userId: u!.user.id, ws: ws!, cat, h };
}

describe("Fase 4 — Category learning", () => {
  it("TI1: PATCH /transactions/:id/category grava categoryId e cria regra", async () => {
    const { ws, cat, h } = await seed("ti1");

    const tx = await prisma.transaction.create({
      data: {
        workspaceId: ws.id,
        type: "expense",
        amountCents: 3500n,
        date: new Date("2026-06-10"),
        description: "iFood pedido",
        counterparty: "iFood",
        source: "manual",
        createdById: ws.createdById,
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/transactions/${tx.id}/category`,
      payload: { categoryId: cat.id },
      headers: h,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().categoryId).toBe(cat.id);

    const rule = await prisma.categoryRule.findFirst({ where: { workspaceId: ws.id, categoryId: cat.id } });
    expect(rule).not.toBeNull();
    expect(rule!.matchType).toBe("contains");
  });
});

describe("Fase 4 — Category rules CRUD", () => {
  it("TI2: GET /category-rules retorna lista vazia inicialmente", async () => {
    const { h } = await seed("ti2");
    const res = await app.inject({ method: "GET", url: "/category-rules", headers: h });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("TI3: POST /category-rules cria regra; DELETE remove", async () => {
    const { ws, cat, h } = await seed("ti3");

    const createRes = await app.inject({
      method: "POST",
      url: "/category-rules",
      payload: { matchType: "contains", pattern: "netflix", categoryId: cat.id, priority: 100 },
      headers: h,
    });
    expect(createRes.statusCode).toBe(201);
    const { id } = createRes.json();

    const deleteRes = await app.inject({ method: "DELETE", url: `/category-rules/${id}`, headers: { authorization: h.authorization } });
    expect(deleteRes.statusCode).toBe(204);

    const remaining = await prisma.categoryRule.findFirst({ where: { id, workspaceId: ws.id } });
    expect(remaining).toBeNull();
  });
});

describe("Fase 4 — Insights API", () => {
  it("TI4: GET /insights retorna lista vazia", async () => {
    const { h } = await seed("ti4");
    const res = await app.inject({ method: "GET", url: "/insights", headers: h });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("TI5: POST /insights/compute enfileira job e retorna jobId", async () => {
    const { h } = await seed("ti5");
    const res = await app.inject({ method: "POST", url: "/insights/compute", payload: {}, headers: h });
    expect(res.statusCode).toBe(201);
    expect(res.json().jobId).toBeTruthy();
  });

  it("TI6: PATCH /insights/:id/read marca como lido", async () => {
    const { ws, h } = await seed("ti6");

    const insight = await prisma.insight.create({
      data: {
        workspaceId: ws.id,
        type: "spike",
        dedupKey: "spike:test-cat",
        period: "2026-06",
        payload: { test: true },
        read: false,
      },
    });

    const res = await app.inject({ method: "PATCH", url: `/insights/${insight.id}/read`, payload: {}, headers: h });
    expect(res.statusCode).toBe(200);
    expect(res.json().read).toBe(true);
  });
});

describe("Fase 4 — Budgets", () => {
  it("TI7: POST /budgets cria orçamento; GET /budgets/status retorna status", async () => {
    const { cat, h } = await seed("ti7");

    const createRes = await app.inject({
      method: "POST",
      url: "/budgets",
      payload: { method: "fixed", categoryId: cat.id, limitCents: 50000 },
      headers: h,
    });
    expect(createRes.statusCode).toBe(200);
    expect(createRes.json().id).toBeTruthy();

    const statusRes = await app.inject({ method: "GET", url: "/budgets/status", headers: h });
    expect(statusRes.statusCode).toBe(200);
    expect(Array.isArray(statusRes.json())).toBe(true);
  });
});

describe("Fase 4 — Goals", () => {
  it("TI8: POST /goals cria meta; POST /goals/:id/contribute adiciona valor", async () => {
    const { h } = await seed("ti8");

    const createRes = await app.inject({
      method: "POST",
      url: "/goals",
      payload: { name: "Viagem", targetCents: 500000 },
      headers: h,
    });
    expect(createRes.statusCode).toBe(201);
    const { id } = createRes.json();

    const contribRes = await app.inject({
      method: "POST",
      url: `/goals/${id}/contribute`,
      payload: { amountCents: 10000 },
      headers: h,
    });
    expect(contribRes.statusCode).toBe(201);

    const goal = await prisma.goal.findUnique({ where: { id } });
    expect(Number(goal!.savedCents)).toBe(10000);
  });
});
