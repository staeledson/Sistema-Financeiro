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

async function newUser(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  return { userId: u!.user.id, workspaceId: ws.id, h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" } };
}

describe("Guardas de entidade e pega-tudo", () => {
  it("categoria pega-tudo do sistema não pode ser renomeada", async () => {
    const u = await newUser("catchall");
    const cat = await prisma.category.findFirstOrThrow({ where: { workspaceId: u.workspaceId, name: "Outras despesas" } });
    const res = await app.inject({ method: "PATCH", url: `/categories/${cat.id}`, headers: u.h, payload: { name: "Diversos" } });
    expect(res.statusCode).toBe(400);
    const cor = await app.inject({ method: "PATCH", url: `/categories/${cat.id}`, headers: u.h, payload: { color: "#333" } });
    expect(cor.statusCode).toBe(200);
  });

  it("categoria não vira exclusiva de uma entidade enquanto a outra a usa (409)", async () => {
    const u = await newUser("catent");
    const pf = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "PF", entity: "pf" } });
    const cat = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Software" } });
    await app.inject({
      method: "POST", url: "/transactions", headers: u.h,
      payload: { type: "expense", amountCents: 1000, date: "2026-10-01", accountId: pf.json().id, categoryId: cat.json().id },
    });
    const toPj = await app.inject({ method: "PATCH", url: `/categories/${cat.json().id}`, headers: u.h, payload: { entity: "pj" } });
    expect(toPj.statusCode).toBe(409);
    const toPf = await app.inject({ method: "PATCH", url: `/categories/${cat.json().id}`, headers: u.h, payload: { entity: "pf" } });
    expect(toPf.statusCode).toBe(200);
  });

  it("conta não muda de entidade enquanto tem lançamentos em categoria exclusiva da entidade atual (409)", async () => {
    const u = await newUser("accent");
    const pj = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "PJ", entity: "pj" } });
    const cat = await prisma.category.findFirstOrThrow({ where: { workspaceId: u.workspaceId, name: "Fornecedores" } }); // entity pj
    await app.inject({
      method: "POST", url: "/transactions", headers: u.h,
      payload: { type: "expense", amountCents: 1000, date: "2026-10-01", accountId: pj.json().id, categoryId: cat.id },
    });
    const res = await app.inject({ method: "PATCH", url: `/accounts/${pj.json().id}`, headers: u.h, payload: { entity: "pf" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/1 lançamento/);
  });
});
