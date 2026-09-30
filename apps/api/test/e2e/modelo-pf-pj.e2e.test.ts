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
  return {
    userId: u!.user.id,
    workspaceId: ws.id,
    h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" },
  };
}

describe("Fase 10 — contas PF/PJ", () => {
  it("conta criada sem entity vira pf/other e sem dados de cartão", async () => {
    const u = await newUser("acc1");
    const res = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Nubank" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      entity: "pf", institution: "other", externalId: null, closingDay: null, dueDay: null, creditLimitCents: null,
    });
  });

  it("cria cartão PJ do C6 com fechamento, vencimento e limite", async () => {
    const u = await newUser("acc2");
    const res = await app.inject({
      method: "POST", url: "/accounts", headers: u.h,
      payload: {
        type: "credit_card", name: "C6 Empresa", entity: "pj", institution: "c6",
        externalId: "1234", closingDay: 10, dueDay: 17, creditLimitCents: 500000,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      entity: "pj", institution: "c6", externalId: "1234", closingDay: 10, dueDay: 17, creditLimitCents: 500000,
    });
  });

  it("rejeita dado de cartão em conta corrente com 400", async () => {
    const u = await newUser("acc3");
    const res = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "X", closingDay: 10 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().message)).toContain("cartão de crédito");
  });

  it("rejeita entity inválida com 400", async () => {
    const u = await newUser("acc4");
    const res = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "X", entity: "xx" } });
    expect(res.statusCode).toBe(400);
  });

  it("GET /accounts?entity filtra por entidade", async () => {
    const u = await newUser("acc5");
    await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta PF", entity: "pf" } });
    await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta PJ", entity: "pj" } });

    const all = await app.inject({ method: "GET", url: "/accounts", headers: u.h });
    expect(all.json().map((a: { name: string }) => a.name).sort()).toEqual(["Conta PF", "Conta PJ"]);

    const pj = await app.inject({ method: "GET", url: "/accounts?entity=pj", headers: u.h });
    expect(pj.json().map((a: { name: string }) => a.name)).toEqual(["Conta PJ"]);

    const pf = await app.inject({ method: "GET", url: "/accounts?entity=pf", headers: u.h });
    expect(pf.json().map((a: { name: string }) => a.name)).toEqual(["Conta PF"]);
  });

  it("GET /accounts?entity=xx retorna 400", async () => {
    const u = await newUser("acc6");
    const res = await app.inject({ method: "GET", url: "/accounts?entity=xx", headers: u.h });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /accounts/:id altera entidade, instituição e número da conta", async () => {
    const u = await newUser("acc7");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta" } });
    const id = created.json().id;

    const res = await app.inject({
      method: "PATCH", url: `/accounts/${id}`, headers: u.h,
      payload: { entity: "pj", institution: "c6", externalId: "99887" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, entity: "pj", institution: "c6", externalId: "99887", name: "Conta" });

    const cleared = await app.inject({ method: "PATCH", url: `/accounts/${id}`, headers: u.h, payload: { externalId: null } });
    expect(cleared.json().externalId).toBeNull();
  });

  it("PATCH com dados de cartão em conta corrente retorna 400", async () => {
    const u = await newUser("acc8");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta" } });
    const res = await app.inject({ method: "PATCH", url: `/accounts/${created.json().id}`, headers: u.h, payload: { dueDay: 5 } });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH em cartão atualiza fechamento, vencimento e limite", async () => {
    const u = await newUser("acc9");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "credit_card", name: "Cartão" } });
    const res = await app.inject({
      method: "PATCH", url: `/accounts/${created.json().id}`, headers: u.h,
      payload: { closingDay: 3, dueDay: 10, creditLimitCents: 120000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ closingDay: 3, dueDay: 10, creditLimitCents: 120000 });
  });

  it("PATCH em conta de outro workspace retorna 404", async () => {
    const a = await newUser("acc10a");
    const b = await newUser("acc10b");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: a.h, payload: { type: "checking", name: "Da A" } });
    const res = await app.inject({ method: "PATCH", url: `/accounts/${created.json().id}`, headers: b.h, payload: { entity: "pj" } });
    expect(res.statusCode).toBe(404);
  });

  it("filtro global: entrada inválida em outra rota validada por Zod também é 400", async () => {
    const u = await newUser("acc11");
    const res = await app.inject({ method: "POST", url: "/transactions", headers: u.h, payload: { type: "expense" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("Fase 10 — categorias por entidade", () => {
  it("novo usuário recebe as 7 categorias PJ de fábrica", async () => {
    const u = await newUser("cat1");
    const list = await app.inject({ method: "GET", url: "/categories", headers: u.h });
    const pj = (list.json() as Array<{ name: string; type: string; entity: string }>).filter((c) => c.entity === "pj");
    expect(pj.map((c) => c.name).sort()).toEqual([
      "Fornecedores", "Folha e terceiros", "Impostos e tributos", "Pró-labore",
      "Receita de serviços", "Serviços contratados", "Tarifas bancárias",
    ].sort());
    expect(pj.find((c) => c.name === "Receita de serviços")?.type).toBe("income");
  });

  it("GET /categories?entity= devolve a entidade pedida mais as compartilhadas (both)", async () => {
    const u = await newUser("cat2");
    await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Só PF", entity: "pf" } });

    const names = async (q: string) =>
      ((await app.inject({ method: "GET", url: `/categories${q}`, headers: u.h })).json() as Array<{ name: string }>).map((c) => c.name);

    const pf = await names("?entity=pf");
    expect(pf).toContain("Só PF");
    expect(pf).toContain("Supermercado");
    expect(pf).not.toContain("Pró-labore");

    const pj = await names("?entity=pj");
    expect(pj).toContain("Pró-labore");
    expect(pj).toContain("Supermercado");
    expect(pj).not.toContain("Só PF");

    expect((await names("")).length).toBe(pf.length + pj.length - (await names("?entity=pf")).filter((n) => pj.includes(n)).length);
  });

  it("combina ?type= e ?entity=", async () => {
    const u = await newUser("cat3");
    const res = await app.inject({ method: "GET", url: "/categories?type=income&entity=pj", headers: u.h });
    const cats = res.json() as Array<{ type: string; entity: string }>;
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every((c) => c.type === "income" && (c.entity === "pj" || c.entity === "both"))).toBe(true);
  });

  it("?entity=xx retorna 400", async () => {
    const u = await newUser("cat4");
    const res = await app.inject({ method: "GET", url: "/categories?entity=xx", headers: u.h });
    expect(res.statusCode).toBe(400);
  });

  it("POST cria com entity (padrão both) e PATCH altera a entity", async () => {
    const u = await newUser("cat5");
    const padrao = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Padrão" } });
    expect(padrao.statusCode).toBe(201);
    expect(padrao.json().entity).toBe("both");

    const pj = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Custo PJ", entity: "pj" } });
    expect(pj.json().entity).toBe("pj");

    const patched = await app.inject({ method: "PATCH", url: `/categories/${pj.json().id}`, headers: u.h, payload: { entity: "both" } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().entity).toBe("both");
  });

  it("PATCH sem entity não reseta a entity existente", async () => {
    const u = await newUser("cat6");
    const created = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Custo PJ", entity: "pj" } });
    const patched = await app.inject({ method: "PATCH", url: `/categories/${created.json().id}`, headers: u.h, payload: { name: "Custo PJ renomeado" } });
    expect(patched.json()).toMatchObject({ name: "Custo PJ renomeado", entity: "pj" });
  });

  it("workspace criado por POST /workspaces também recebe as categorias PJ", async () => {
    const u = await newUser("cat7");
    const ws = await app.inject({ method: "POST", url: "/workspaces", headers: u.h, payload: { type: "business", name: "Empresa" } });
    expect(ws.statusCode).toBe(201);
    const list = await app.inject({
      method: "GET", url: "/categories?entity=pj", headers: { ...u.h, "x-workspace-id": ws.json().id },
    });
    expect((list.json() as Array<{ name: string }>).map((c) => c.name)).toContain("Pró-labore");
  });
});
