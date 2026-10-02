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

describe("POST /workspaces/:id/members", () => {
  it("T3: usuário A não pode adicionar membros no workspace de B", async () => {
    const ts = Date.now();
    const a = await auth.api.signUpEmail({
      body: { email: `a_t3_${ts}@example.com`, password: "senha123!", name: "A" },
    });
    const b = await auth.api.signUpEmail({
      body: { email: `b_t3_${ts}@example.com`, password: "senha123!", name: "B" },
    });

    const bWsRes = await app.inject({
      method: "GET",
      url: "/workspaces",
      headers: { authorization: `Bearer ${b!.token}` },
    });
    const bWorkspaceId = bWsRes.json()[0].id;

    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${bWorkspaceId}/members`,
      headers: { authorization: `Bearer ${a!.token}`, "content-type": "application/json" },
      payload: { userId: a!.user.id, role: "member" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("owner pode adicionar um membro ao seu workspace", async () => {
    const ts = Date.now();
    const owner = await auth.api.signUpEmail({
      body: { email: `owner_${ts}@example.com`, password: "senha123!", name: "Owner" },
    });
    const newMember = await auth.api.signUpEmail({
      body: { email: `newmember_${ts}@example.com`, password: "senha123!", name: "New" },
    });

    const wsRes = await app.inject({
      method: "GET",
      url: "/workspaces",
      headers: { authorization: `Bearer ${owner!.token}` },
    });
    const workspaceId = wsRes.json()[0].id;

    const res = await app.inject({
      method: "POST",
      url: `/workspaces/${workspaceId}/members`,
      headers: { authorization: `Bearer ${owner!.token}`, "content-type": "application/json" },
      payload: { userId: newMember!.user.id, role: "member" },
    });
    expect(res.statusCode).toBe(201);

    const body = res.json();
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.userId).toBe(newMember!.user.id);
    expect(body.role).toBe("member");
  });
});

async function signUp(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  return {
    id: u!.user.id,
    wsId: ws.id,
    h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" },
  };
}

describe("Permissões de membros", () => {
  it("GET /workspaces/:id/members de um workspace alheio responde 403", async () => {
    const a = await signUp("perm_a");
    const b = await signUp("perm_b");
    const res = await app.inject({ method: "GET", url: `/workspaces/${b.wsId}/members`, headers: a.h });
    expect(res.statusCode).toBe(403);
    const own = await app.inject({ method: "GET", url: `/workspaces/${a.wsId}/members`, headers: a.h });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toHaveLength(1);
  });

  it("role inválido em POST e PATCH responde 400", async () => {
    const owner = await signUp("perm_role");
    const other = await signUp("perm_role2");
    const add = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: other.id, role: "deus" },
    });
    expect(add.statusCode).toBe(400);
    const patch = await app.inject({
      method: "PATCH", url: `/workspaces/${owner.wsId}/members/${owner.id}/role`, headers: owner.h,
      payload: { role: "" },
    });
    expect(patch.statusCode).toBe(400);
  });

  it("admin não rebaixa um owner (403) e o único owner não pode ser rebaixado (409)", async () => {
    const owner = await signUp("perm_owner");
    const admin = await signUp("perm_admin");
    await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: admin.id, role: "admin" },
    });
    const byAdmin = await app.inject({
      method: "PATCH", url: `/workspaces/${owner.wsId}/members/${owner.id}/role`, headers: admin.h,
      payload: { role: "member" },
    });
    expect(byAdmin.statusCode).toBe(403);
    const byOwner = await app.inject({
      method: "PATCH", url: `/workspaces/${owner.wsId}/members/${owner.id}/role`, headers: owner.h,
      payload: { role: "member" },
    });
    expect(byOwner.statusCode).toBe(409);
  });

  it("adicionar usuário inexistente responde 404 e repetido responde 409", async () => {
    const owner = await signUp("perm_dup");
    const other = await signUp("perm_dup2");
    const missing = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: "nao-existe", role: "member" },
    });
    expect(missing.statusCode).toBe(404);
    const first = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: other.id, role: "member" },
    });
    expect(first.statusCode).toBe(201);
    const again = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: other.id, role: "member" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("POST /workspaces valida tipo e nome", async () => {
    const u = await signUp("perm_ws");
    const bad = await app.inject({ method: "POST", url: "/workspaces", headers: u.h, payload: { type: "clube", name: "" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/workspaces", headers: u.h, payload: { type: "family", name: "  Casa  " } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().name).toBe("Casa");
    expect(ok.json().currency).toBe("BRL");
  });

  it("convite recusa papel owner e e-mail inválido (400) e normaliza o e-mail", async () => {
    const owner = await signUp("perm_inv");
    const asOwner = await app.inject({ method: "POST", url: "/invitations", headers: owner.h, payload: { email: "x@y.com", role: "owner" } });
    expect(asOwner.statusCode).toBe(400);
    const badEmail = await app.inject({ method: "POST", url: "/invitations", headers: owner.h, payload: { email: "nao-e-email" } });
    expect(badEmail.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/invitations", headers: owner.h, payload: { email: "  Ana@Exemplo.com " } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().email).toBe("ana@exemplo.com");
    expect(ok.json().role).toBe("member");
  });
});
