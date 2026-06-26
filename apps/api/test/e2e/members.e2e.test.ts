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
