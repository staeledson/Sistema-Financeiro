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

describe("GET /workspaces", () => {
  it("T2: usuário A não vê workspaces de B (isolamento)", async () => {
    const ts = Date.now();
    const a = await auth.api.signUpEmail({
      body: { email: `a_${ts}@example.com`, password: "senha123!", name: "User A" },
    });
    const b = await auth.api.signUpEmail({
      body: { email: `b_${ts}@example.com`, password: "senha123!", name: "User B" },
    });

    const aRes = await app.inject({
      method: "GET",
      url: "/workspaces",
      headers: { authorization: `Bearer ${a!.token}` },
    });
    const bRes = await app.inject({
      method: "GET",
      url: "/workspaces",
      headers: { authorization: `Bearer ${b!.token}` },
    });

    expect(aRes.statusCode).toBe(200);
    expect(bRes.statusCode).toBe(200);

    const aWs = aRes.json();
    const bWs = bRes.json();

    expect(aWs).toHaveLength(1);
    expect(bWs).toHaveLength(1);
    expect(aWs[0].id).not.toBe(bWs[0].id);
    expect(aWs[0].type).toBe("personal");
  });

  it("401 sem token", async () => {
    const res = await app.inject({ method: "GET", url: "/workspaces" });
    expect(res.statusCode).toBe(401);
  });
});
