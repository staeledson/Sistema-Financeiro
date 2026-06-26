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

const CSV_SAMPLE = `Data,Valor,Descricao
05/06/2026,-35.00,iFood
10/06/2026,1000.00,Salário
15/06/2026,-35.00,iFood
`.trim();

const MAPPING = {
  dateColumn: "Data",
  amountColumn: "Valor",
  descriptionColumn: "Descricao",
  dateFormat: "DD/MM/YYYY",
  decimalSeparator: ".",
  expenseIsNegative: true,
};

describe("Fase 3 — Import CSV/OFX", () => {
  it("TM1: POST /import/csv/preview retorna preview com rows e batchId", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `tm1_${ts}@test.com`, password: "senha123!", name: "TM1" } });
    const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
    const acct = await prisma.bankAccount.create({
      data: { workspaceId: ws!.id, type: "checking", name: "Conta Corrente" },
    });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const res = await app.inject({
      method: "POST",
      url: "/import/csv/preview",
      headers: h,
      payload: { accountId: acct.id, mapping: MAPPING, csv: CSV_SAMPLE },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rowCount).toBe(3);
    expect(typeof body.batchId).toBe("string");
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows[0].type).toBe("expense");
    expect(body.rows[0].amountCents).toBe(3500);
    expect(body.rows[1].type).toBe("income");
  });

  it("TM2: POST /import/:batchId/commit insere transações idempotentemente", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `tm2_${ts}@test.com`, password: "senha123!", name: "TM2" } });
    const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
    const acct = await prisma.bankAccount.create({
      data: { workspaceId: ws!.id, type: "checking", name: "CC TM2" },
    });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const preview = await app.inject({
      method: "POST",
      url: "/import/csv/preview",
      headers: h,
      payload: { accountId: acct.id, mapping: MAPPING, csv: CSV_SAMPLE },
    });
    const { batchId, rows } = preview.json();

    const commit1 = await app.inject({
      method: "POST",
      url: `/import/${batchId}/commit`,
      headers: h,
      payload: { rows },
    });
    expect(commit1.statusCode).toBe(200);

    // Second commit — same fingerprints → 0 new inserted (idempotent)
    const commit2 = await app.inject({
      method: "POST",
      url: `/import/${batchId}/commit`,
      headers: h,
      payload: { rows },
    });
    expect(commit2.statusCode).toBe(200);

    const total = await prisma.transaction.count({ where: { workspaceId: ws!.id } });
    expect(total).toBe(3);
  });

  it("TM3: dupCount correto no segundo preview após commit", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `tm3_${ts}@test.com`, password: "senha123!", name: "TM3" } });
    const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
    const acct = await prisma.bankAccount.create({
      data: { workspaceId: ws!.id, type: "checking", name: "CC TM3" },
    });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    // First preview + commit
    const p1 = await app.inject({
      method: "POST", url: "/import/csv/preview", headers: h,
      payload: { accountId: acct.id, mapping: MAPPING, csv: CSV_SAMPLE },
    });
    const { batchId, rows } = p1.json();
    await app.inject({ method: "POST", url: `/import/${batchId}/commit`, headers: h, payload: { rows } });

    // Second preview of same CSV — all 3 rows should be flagged as dups
    const p2 = await app.inject({
      method: "POST", url: "/import/csv/preview", headers: h,
      payload: { accountId: acct.id, mapping: MAPPING, csv: CSV_SAMPLE },
    });
    expect(p2.json().dupCount).toBe(3);
    expect(p2.json().rows.every((r: { dup: boolean }) => r.dup)).toBe(true);
  });

  it("TM4: POST /import/mappings salva e GET /import/mappings lista mapeamentos", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `tm4_${ts}@test.com`, password: "senha123!", name: "TM4" } });
    const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };

    const save = await app.inject({
      method: "POST", url: "/import/mappings", headers: h,
      payload: { name: "Meu Banco", format: "csv", mapping: MAPPING },
    });
    expect(save.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/import/mappings", headers: h });
    expect(list.statusCode).toBe(200);
    expect(list.json().length).toBe(1);
    expect(list.json()[0].name).toBe("Meu Banco");
  });
});
