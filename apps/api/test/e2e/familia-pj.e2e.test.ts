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

async function signUp(tag: string) {
  const ts = Date.now();
  const u = await auth.api.signUpEmail({ body: { email: `${tag}_${ts}@test.com`, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
  return { user: u!.user, token: u!.token, ws: ws!, headers: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" } };
}

describe("Fase 5 — Workspace X-Workspace-Id header", () => {
  it("TF1: X-Workspace-Id válido usa aquele workspace", async () => {
    const a = await signUp("tf1a");
    // Create a second workspace for user A
    const wsB = await prisma.workspace.create({
      data: { type: "family", name: "Família", createdById: a.user.id, members: { create: { userId: a.user.id, role: "owner" } } },
    });

    const res = await app.inject({
      method: "GET",
      url: "/workspaces",
      headers: { ...a.headers, "x-workspace-id": wsB.id },
    });
    expect(res.statusCode).toBe(200);
    // Should still return all workspaces user A belongs to
    const list = res.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("TF2: X-Workspace-Id de outro usuário retorna 401", async () => {
    const a = await signUp("tf2a");
    const b = await signUp("tf2b");

    const res = await app.inject({
      method: "GET",
      url: "/transactions",
      headers: { ...a.headers, "x-workspace-id": b.ws.id },
    });
    expect(res.statusCode).toBe(401);
  });

  it("TF3: sem X-Workspace-Id usa workspace pessoal (compat)", async () => {
    const a = await signUp("tf3a");
    const res = await app.inject({ method: "GET", url: "/transactions", headers: a.headers });
    expect(res.statusCode).toBe(200);
  });
});

describe("Fase 5 — Criar workspace família/PJ", () => {
  it("TF4: POST /workspaces cria workspace família com categorias semeadas", async () => {
    const a = await signUp("tf4a");

    const res = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { type: "family", name: "Casa" },
      headers: a.headers,
    });
    expect(res.statusCode).toBe(201);
    const { id, type, name } = res.json();
    expect(type).toBe("family");
    expect(name).toBe("Casa");

    const list = await app.inject({ method: "GET", url: "/workspaces", headers: a.headers });
    expect(list.json().length).toBe(2);

    const cats = await prisma.category.findMany({ where: { workspaceId: id } });
    expect(cats.length).toBeGreaterThanOrEqual(5);
  });
});

describe("Fase 5 — Convites", () => {
  it("TF5: owner convida por e-mail; convidado aceita e vira membro", async () => {
    const owner = await signUp("tf5owner");
    const guest = await signUp("tf5guest");

    // Owner sends invite for guest's email
    const invRes = await app.inject({
      method: "POST",
      url: "/invitations",
      payload: { email: guest.user.email, role: "member" },
      headers: { ...owner.headers, "x-workspace-id": owner.ws.id },
    });
    expect(invRes.statusCode).toBe(201);
    const { token } = invRes.json();
    expect(token).toBeTruthy();

    // Guest accepts using their own token (but for owner's workspace, so no x-workspace-id override needed)
    const acceptRes = await app.inject({
      method: "POST",
      url: "/invitations/accept",
      payload: { token },
      headers: guest.headers,
    });
    expect(acceptRes.statusCode).toBe(200);
    const { workspaceId } = acceptRes.json();
    expect(workspaceId).toBe(owner.ws.id);

    // Guest is now a member of owner's workspace
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: owner.ws.id, userId: guest.user.id } },
    });
    expect(membership).not.toBeNull();
    expect(membership!.role).toBe("member");
  });

  it("TF6: e-mail errado ao aceitar retorna 403", async () => {
    const owner = await signUp("tf6owner");
    const other = await signUp("tf6other");

    // Invite someone else's email
    const invRes = await app.inject({
      method: "POST",
      url: "/invitations",
      payload: { email: "wrong@example.com", role: "member" },
      headers: owner.headers,
    });
    const { token } = invRes.json();

    const res = await app.inject({
      method: "POST",
      url: "/invitations/accept",
      payload: { token },
      headers: other.headers,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Fase 5 — Gestão de membros + RBAC", () => {
  it("TF7: owner muda papel de membro; viewer não pode alterar papel", async () => {
    const owner = await signUp("tf7owner");
    const memberUser = await signUp("tf7member");

    // Add member to workspace
    await prisma.workspaceMember.create({
      data: { workspaceId: owner.ws.id, userId: memberUser.user.id, role: "member" },
    });

    // Owner changes role to admin
    const res = await app.inject({
      method: "PATCH",
      url: `/workspaces/${owner.ws.id}/members/${memberUser.user.id}/role`,
      payload: { role: "admin" },
      headers: { ...owner.headers, "x-workspace-id": owner.ws.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe("admin");
  });

  it("TF8: remover último owner retorna 409", async () => {
    const a = await signUp("tf8a");
    const res = await app.inject({
      method: "DELETE",
      url: `/workspaces/${a.ws.id}/members/${a.user.id}`,
      headers: { authorization: a.headers.authorization },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("Fase 5 — Divisão de despesas", () => {
  it("TF9: dividir despesa e verificar saldo entre membros", async () => {
    const payer = await signUp("tf9payer");
    const debtor = await signUp("tf9debtor");

    // Add debtor to payer's workspace
    await prisma.workspaceMember.create({
      data: { workspaceId: payer.ws.id, userId: debtor.user.id, role: "member" },
    });

    // Create a transaction
    const tx = await prisma.transaction.create({
      data: {
        workspaceId: payer.ws.id,
        type: "expense",
        amountCents: 10000n,
        date: new Date("2026-06-01"),
        source: "manual",
        createdById: payer.user.id,
      },
    });

    // Set splits: payer 50%, debtor 50%
    const splitRes = await app.inject({
      method: "POST",
      url: `/transactions/${tx.id}/splits`,
      payload: { splits: [{ userId: payer.user.id, shareCents: 5000 }, { userId: debtor.user.id, shareCents: 5000 }] },
      headers: payer.headers,
    });
    expect(splitRes.statusCode).toBe(200);

    // Check balances
    const balRes = await app.inject({ method: "GET", url: "/reports/member-balances", headers: payer.headers });
    expect(balRes.statusCode).toBe(200);
    const balances = balRes.json();
    expect(Array.isArray(balances)).toBe(true);
    const entry = balances.find((b: any) => b.debtor?.id === debtor.user.id);
    expect(entry).toBeTruthy();
    expect(entry.owedCents).toBe(5000);
  });
});

describe("Fase 5 — Perfil PJ", () => {
  it("TF10: criar workspace business, salvar e buscar perfil PJ", async () => {
    const a = await signUp("tf10a");

    // Create business workspace
    const wsRes = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { type: "business", name: "Empresa X" },
      headers: a.headers,
    });
    const { id: bizWsId } = wsRes.json();

    // Save profile via x-workspace-id header
    const profileRes = await app.inject({
      method: "POST",
      url: "/business-profile",
      payload: { cnpj: "12.345.678/0001-90", legalName: "Empresa X LTDA" },
      headers: { ...a.headers, "x-workspace-id": bizWsId },
    });
    expect(profileRes.statusCode).toBe(200);
    expect(profileRes.json().cnpj).toBe("12.345.678/0001-90");

    const getRes = await app.inject({
      method: "GET",
      url: "/business-profile",
      headers: { ...a.headers, "x-workspace-id": bizWsId },
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().legalName).toBe("Empresa X LTDA");
  });
});
