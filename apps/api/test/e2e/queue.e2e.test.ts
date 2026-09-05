import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Queue } from "bullmq";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import type { IngestJobData } from "../../src/ingest/ingest.types";

let app: NestFastifyApplication;
let queue: Queue<IngestJobData>;

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6380");

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  queue = new Queue<IngestJobData>("ai", {
    connection: { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 },
    prefix: process.env.BULLMQ_PREFIX ?? "bull",
  });
  await queue.obliterate({ force: true });
});

afterAll(async () => {
  await queue.close();
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

async function waitingJobs() {
  const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"]);
  return jobs.map((j) => j.data);
}

describe("Fase 9 — fila de categorização", () => {
  it("POST /transactions/categorize cria AiJob e enfileira job kind=categorize", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `q1_${ts}@test.com`, password: "senha123!", name: "Q1" } });
    const h = { authorization: `Bearer ${u!.token}` };

    const res = await app.inject({ method: "POST", url: "/transactions/categorize", headers: h });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };

    const aiJob = await prisma.aiJob.findUnique({ where: { id } });
    expect(aiJob?.kind).toBe("categorize");

    const jobs = await waitingJobs();
    const mine = jobs.find((j) => j.jobId === id);
    expect(mine).toBeDefined();
    expect(mine!.kind).toBe("categorize");
    expect(mine!.workspaceId).toBe(aiJob!.workspaceId);
    expect(mine!.batchId).toBeUndefined();
  });

  it("commit de importação enfileira categorize com o batchId", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `q2_${ts}@test.com`, password: "senha123!", name: "Q2" } });
    const h = { authorization: `Bearer ${u!.token}` };
    const jh = { ...h, "content-type": "application/json" };

    const acc = await app.inject({ method: "POST", url: "/accounts", headers: jh, payload: { type: "checking", name: "C6", openingBalanceCents: 0 } });
    const accountId = acc.json().id as string;

    const preview = await app.inject({
      method: "POST", url: "/import/csv/preview", headers: jh,
      payload: {
        accountId,
        mapping: { dateColumn: "Data", amountColumn: "Valor", descriptionColumn: "Desc", dateFormat: "DD/MM/YYYY", decimalSeparator: ".", expenseIsNegative: true },
        csv: "Data,Valor,Desc\n05/06/2026,-35.00,iFood\n",
      },
    });
    expect(preview.statusCode).toBe(200);
    const { batchId, rows } = preview.json() as { batchId: string; rows: unknown[] };

    const commit = await app.inject({ method: "POST", url: `/import/${batchId}/commit`, headers: jh, payload: { rows } });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().inserted).toBe(1);

    const jobs = await waitingJobs();
    const mine = jobs.find((j) => j.kind === "categorize" && j.batchId === batchId);
    expect(mine).toBeDefined();
  });
});
