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

async function setup(label: string) {
  const u = await auth.api.signUpEmail({ body: { email: `${label}_${Date.now()}@test.com`, password: "senha123!", name: label } });
  const ws = await prisma.workspace.findFirst({ where: { createdById: u!.user.id } });
  return { u: u!, ws: ws!, h: { authorization: `Bearer ${u!.token}` } };
}

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^﻿/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
};

describe("GET /export/analise.csv", () => {
  it("exige login", async () => {
    const res = await app.inject({ method: "GET", url: "/export/analise.csv" });
    expect(res.statusCode).toBe(401);
  });

  it("traz todos os lançamentos com conta, entidade, categoria, par e ignorado, só do workspace", async () => {
    const a = await setup("exp1");
    const b = await setup("exp2");
    const pj = await prisma.bankAccount.create({ data: { workspaceId: a.ws.id, type: "checking", name: "C6 PJ", entity: "pj", institution: "c6" } });
    const pf = await prisma.bankAccount.create({ data: { workspaceId: a.ws.id, type: "checking", name: "MP PF", entity: "pf", institution: "mercado_pago" } });
    const cat = await prisma.category.create({ data: { workspaceId: a.ws.id, type: "expense", name: "Mercado, \"bom\"" } });
    const base = { workspaceId: a.ws.id, source: "import", createdById: a.u.user.id };
    await prisma.transaction.create({ data: { ...base, type: "expense", amountCents: 123456, date: new Date("2026-09-10"), accountId: pj.id, categoryId: cat.id, description: 'Compra "x", loja', importFingerprint: "e1" } });
    await prisma.transaction.create({ data: { ...base, type: "income", amountCents: 1500000, date: new Date("2026-09-11"), accountId: pf.id, description: "Pix recebido", ignored: true, importFingerprint: "e2" } });
    await prisma.transaction.create({ data: { ...base, type: "expense", amountCents: 5000, date: new Date("2026-09-12"), accountId: pf.id, description: "Par", transferPairId: "par-1", importFingerprint: "e3" } });
    await prisma.transaction.create({ data: { ...base, type: "transfer", amountCents: 350, date: new Date("2026-09-13"), accountId: pf.id, sourceAccountId: pf.id, destAccountId: pj.id, description: "Reserva", importFingerprint: "e4" } });
    const bAcc = await prisma.bankAccount.create({ data: { workspaceId: b.ws.id, type: "checking", name: "Outra" } });
    await prisma.transaction.create({ data: { workspaceId: b.ws.id, type: "expense", amountCents: 999, date: new Date("2026-09-10"), accountId: bAcc.id, description: "OUTRO WORKSPACE", source: "import", createdById: b.u.user.id, importFingerprint: "x1" } });

    const res = await app.inject({ method: "GET", url: "/export/analise.csv", headers: a.h });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(String(res.headers["content-disposition"])).toContain("attachment");

    const [header, ...rows] = parseCsv(res.body);
    expect(rows).toHaveLength(4);
    const col = (name: string) => header.indexOf(name);
    for (const c of ["data", "tipo", "valor", "entidade", "conta", "categoria", "descricao", "par_transferencia", "ignorado", "destino"]) {
      expect(col(c)).toBeGreaterThanOrEqual(0);
    }
    const byDesc = (d: string) => rows.find((r) => r[col("descricao")] === d)!;

    const compra = byDesc('Compra "x", loja');
    expect(compra[col("data")]).toBe("2026-09-10");
    expect(compra[col("tipo")]).toBe("expense");
    expect(compra[col("valor")]).toBe("-1234.56");
    expect(compra[col("entidade")]).toBe("pj");
    expect(compra[col("conta")]).toBe("C6 PJ");
    expect(compra[col("categoria")]).toBe('Mercado, "bom"');
    expect(compra[col("ignorado")]).toBe("nao");

    const pix = byDesc("Pix recebido");
    expect(pix[col("valor")]).toBe("15000.00");
    expect(pix[col("ignorado")]).toBe("sim");
    expect(pix[col("categoria")]).toBe("");

    expect(byDesc("Par")[col("par_transferencia")]).toBe("par-1");

    const reserva = byDesc("Reserva");
    expect(reserva[col("tipo")]).toBe("transfer");
    expect(reserva[col("origem")]).toBe("MP PF");
    expect(reserva[col("destino")]).toBe("C6 PJ");
    expect(res.body).not.toContain("OUTRO WORKSPACE");
  });
});
