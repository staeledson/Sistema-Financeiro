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

describe("Fase 2 — Ingestão por IA", () => {
  it("TI1: POST /ingest/text cria ai_job e retorna jobId", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `ti1_${ts}@test.com`, password: "senha123!", name: "TI1" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const res = await app.inject({
      method: "POST",
      url: "/ingest/text",
      headers: h,
      payload: { text: "almoço 35 no ifood" },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    expect(typeof jobId).toBe("string");

    const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
    expect(job?.status).toBe("queued");
    expect(job?.kind).toBe("parse_text");
  });

  it("TI2: POST /ingest/upload-url retorna URL e storagePath", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `ti2_${ts}@test.com`, password: "senha123!", name: "TI2" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const res = await app.inject({
      method: "POST",
      url: "/ingest/upload-url",
      headers: h,
      payload: { ext: "jpg", contentType: "image/jpeg" },
    });
    expect(res.statusCode).toBe(201);
    const { url, storagePath } = res.json();
    expect(typeof url).toBe("string");
    expect(typeof storagePath).toBe("string");
    expect(storagePath.endsWith(".jpg")).toBe(true);
  });

  it("TI3: POST /ingest/image cria ai_job com kind parse_image", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `ti3_${ts}@test.com`, password: "senha123!", name: "TI3" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const res = await app.inject({
      method: "POST",
      url: "/ingest/image",
      headers: h,
      payload: { storagePath: "fake-ws/some-file.jpg" },
    });
    expect(res.statusCode).toBe(201);
    const { jobId } = res.json();
    const job = await prisma.aiJob.findUnique({ where: { id: jobId } });
    expect(job?.kind).toBe("parse_image");
    expect(job?.status).toBe("queued");
  });

  it("TI4: GET /ingest/jobs/:id retorna status do job", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `ti4_${ts}@test.com`, password: "senha123!", name: "TI4" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const create = await app.inject({ method: "POST", url: "/ingest/text", headers: h, payload: { text: "teste" } });
    const { jobId } = create.json();

    const status = await app.inject({ method: "GET", url: `/ingest/jobs/${jobId}`, headers: h });
    expect(status.statusCode).toBe(200);
    expect(status.json().status).toBe("queued");
  });
});
