import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Queue } from "bullmq";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { AI_QUEUE } from "../../src/queue/queue.tokens";
import { SIGNUP_DENIED_MESSAGE } from "../../src/auth/signup-policy";

let app: NestFastifyApplication;
const allowedBefore = process.env["SIGNUP_ALLOWED_EMAILS"];
const nodeEnvBefore = process.env["NODE_ENV"];

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  if (allowedBefore === undefined) delete process.env["SIGNUP_ALLOWED_EMAILS"];
  else process.env["SIGNUP_ALLOWED_EMAILS"] = allowedBefore;
  process.env["NODE_ENV"] = nodeEnvBefore;
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

const unique = (tag: string) => `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
const signUp = (email: string) =>
  auth.api.signUpEmail({ body: { email, password: "senha123!", name: "Teste" } });

describe("GET /health", () => {
  it("responde 200 { ok, db, redis } sem token", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true, redis: true });
  });

  it("responde 503 sem vazar o erro quando o banco falha (redis segue informativo)", async () => {
    // vi.spyOn + mockRestore deixa o $queryRaw do Prisma inutilizável (o original vem de um proxy): troca e devolve à mão.
    const client = prisma as unknown as { $queryRaw: unknown };
    const original = client.$queryRaw;
    client.$queryRaw = vi.fn().mockRejectedValue(new Error("senha do banco: segredo"));
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, db: false, redis: true });
      expect(res.body).not.toContain("segredo");
    } finally {
      client.$queryRaw = original;
    }
  });

  it("Redis fora do ar NÃO derruba o 200: só redis:false, sem vazar o erro", async () => {
    const queue = app.get<Queue>(AI_QUEUE);
    const client = (await queue.client) as unknown as { ping(): Promise<string> };
    const spy = vi.spyOn(client, "ping").mockRejectedValue(new Error("NOAUTH segredo-redis"));
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, db: true, redis: false });
      expect(res.body).not.toContain("segredo-redis");
    } finally {
      spy.mockRestore();
    }
  });

  it("PING do Redis que não responde estoura o tempo e vira redis:false (ainda 200)", async () => {
    const queue = app.get<Queue>(AI_QUEUE);
    const client = (await queue.client) as unknown as { ping(): Promise<string> };
    const spy = vi.spyOn(client, "ping").mockImplementation(() => new Promise(() => {}));
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true, db: true, redis: false });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("cadastro por lista de permissão (SIGNUP_ALLOWED_EMAILS)", () => {
  it("recusa email fora da lista e não cria usuário nem workspace", async () => {
    const permitido = unique("permitido");
    const bloqueado = unique("bloqueado");
    process.env["SIGNUP_ALLOWED_EMAILS"] = `${permitido}, outro@test.com`;
    const workspacesAntes = await prisma.workspace.count();

    await expect(signUp(bloqueado)).rejects.toThrow();

    expect(await prisma.user.count({ where: { email: bloqueado } })).toBe(0);
    expect(await prisma.workspace.count()).toBe(workspacesAntes);
  });

  it("cria normalmente o email da lista (sem diferenciar maiúsculas)", async () => {
    const permitido = unique("permitido");
    process.env["SIGNUP_ALLOWED_EMAILS"] = permitido.toUpperCase();
    const res = await signUp(permitido);
    expect(res?.user.email).toBe(permitido);
    expect(await prisma.workspace.count({ where: { createdById: res!.user.id } })).toBe(1);
  });

  it("sem a variável, qualquer email cria conta", async () => {
    delete process.env["SIGNUP_ALLOWED_EMAILS"];
    const res = await signUp(unique("livre"));
    expect(res?.user.id).toBeTruthy();
    expect(await prisma.workspace.count({ where: { createdById: res!.user.id } })).toBe(1);
  });
});

describe("cadastro fecha por padrão em produção", () => {
  const comNodeEnv = async (valor: string, fn: () => Promise<void>) => {
    process.env["NODE_ENV"] = valor;
    try {
      await fn();
    } finally {
      process.env["NODE_ENV"] = nodeEnvBefore;
    }
  };

  it("NODE_ENV=production sem a lista: recusa com a mensagem padrão e não cria usuário", async () => {
    delete process.env["SIGNUP_ALLOWED_EMAILS"];
    const email = unique("fechado");
    await comNodeEnv("production", async () => {
      await expect(signUp(email)).rejects.toThrow(SIGNUP_DENIED_MESSAGE);
    });
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it("NODE_ENV=production com lista: só quem está nela", async () => {
    const permitido = unique("lista");
    process.env["SIGNUP_ALLOWED_EMAILS"] = permitido;
    await comNodeEnv("production", async () => {
      await expect(signUp(unique("fora"))).rejects.toThrow(SIGNUP_DENIED_MESSAGE);
      expect((await signUp(permitido))?.user.email).toBe(permitido);
    });
  });

  it("NODE_ENV=production com '*': cadastro aberto (opt-in explícito)", async () => {
    process.env["SIGNUP_ALLOWED_EMAILS"] = "*";
    await comNodeEnv("production", async () => {
      expect((await signUp(unique("aberto")))?.user.id).toBeTruthy();
    });
  });
});
