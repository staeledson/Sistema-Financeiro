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

describe("Fase 2 — Revisão de Rascunhos", () => {
  it("TD1: GET /drafts retorna rascunhos pendentes do workspace", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `td1_${ts}@test.com`, password: "senha123!", name: "TD1" } });
    const h = { authorization: `Bearer ${u!.token}` };

    // seed draft via prisma
    const member = await prisma.workspaceMember.findFirst({ where: { userId: u!.user.id } });
    await prisma.transactionDraft.create({
      data: {
        workspaceId: member!.workspaceId,
        kind: "parse_text",
        type: "expense",
        amountCents: 4500n,
        date: new Date("2026-06-01"),
        description: "Almoço",
        confidence: 0.9,
        createdById: u!.user.id,
      },
    });

    const res = await app.inject({ method: "GET", url: "/drafts", headers: h });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].description).toBe("Almoço");
  });

  it("TD2: confirmar rascunho cria transação real e remove da fila", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `td2_${ts}@test.com`, password: "senha123!", name: "TD2" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    // criar conta bancária
    const acc = await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "checking", name: "C1" } });
    const accountId = acc.json().id;

    const member = await prisma.workspaceMember.findFirst({ where: { userId: u!.user.id } });
    const catList = await app.inject({ method: "GET", url: "/categories?type=expense", headers: h });
    const categoryId = catList.json()[0].id;

    const draft = await prisma.transactionDraft.create({
      data: {
        workspaceId: member!.workspaceId,
        kind: "parse_text",
        type: "expense",
        amountCents: 7500n,
        date: new Date("2026-06-10"),
        description: "Farmácia",
        categoryId,
        confidence: 0.88,
        createdById: u!.user.id,
      },
    });

    // confirmar com accountId
    const confirm = await app.inject({
      method: "POST",
      url: `/drafts/${draft.id}/confirm`,
      headers: h,
      payload: { accountId },
    });
    expect(confirm.statusCode).toBe(201);
    expect(confirm.json().amountCents).toBe(7500);

    // draft deve sumir da fila
    const listAfter = await app.inject({ method: "GET", url: "/drafts", headers: h });
    const remaining = listAfter.json().filter((d: { id: string }) => d.id === draft.id);
    expect(remaining).toHaveLength(0);

    // transação deve existir
    const txList = await app.inject({ method: "GET", url: "/transactions", headers: h });
    const found = txList.json().find((t: { description: string }) => t.description === "Farmácia");
    expect(found).toBeTruthy();
  });

  it("TD3: descartar rascunho remove da fila", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `td3_${ts}@test.com`, password: "senha123!", name: "TD3" } });
    const h = { authorization: `Bearer ${u!.token}` };

    const member = await prisma.workspaceMember.findFirst({ where: { userId: u!.user.id } });
    const draft = await prisma.transactionDraft.create({
      data: {
        workspaceId: member!.workspaceId,
        kind: "parse_text",
        type: "expense",
        amountCents: 1000n,
        date: new Date("2026-06-05"),
        confidence: 0.7,
        createdById: u!.user.id,
      },
    });

    const del = await app.inject({ method: "DELETE", url: `/drafts/${draft.id}`, headers: h });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: "/drafts", headers: h });
    const found = list.json().find((d: { id: string }) => d.id === draft.id);
    expect(found).toBeUndefined();
  });

  it("TD4: rascunhos isolados entre workspaces", async () => {
    const ts = Date.now();
    const a = await auth.api.signUpEmail({ body: { email: `td4a_${ts}@test.com`, password: "senha123!", name: "A" } });
    const b = await auth.api.signUpEmail({ body: { email: `td4b_${ts}@test.com`, password: "senha123!", name: "B" } });

    const memberA = await prisma.workspaceMember.findFirst({ where: { userId: a!.user.id } });

    await prisma.transactionDraft.create({
      data: {
        workspaceId: memberA!.workspaceId,
        kind: "parse_text",
        type: "income",
        amountCents: 10000n,
        date: new Date("2026-06-01"),
        confidence: 0.95,
        createdById: a!.user.id,
      },
    });

    const bList = await app.inject({
      method: "GET",
      url: "/drafts",
      headers: { authorization: `Bearer ${b!.token}` },
    });
    // B não vê rascunhos de A
    expect(bList.json()).toHaveLength(0);
  });
});
