import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";

let app: NestFastifyApplication;
const allowedBefore = process.env["SIGNUP_ALLOWED_EMAILS"];

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  if (allowedBefore === undefined) delete process.env["SIGNUP_ALLOWED_EMAILS"];
  else process.env["SIGNUP_ALLOWED_EMAILS"] = allowedBefore;
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

const unique = (tag: string) => `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
const signUp = (email: string) =>
  auth.api.signUpEmail({ body: { email, password: "senha123!", name: "Teste" } });

describe("GET /health", () => {
  it("responde 200 { ok, db } sem token", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: true });
  });

  it("responde 503 { ok: false, db: false } sem vazar o erro quando o banco falha", async () => {
    const spy = vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("senha do banco: segredo"));
    try {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ ok: false, db: false });
      expect(res.body).not.toContain("segredo");
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
