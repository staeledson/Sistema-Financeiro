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

async function newUser(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  return {
    userId: u!.user.id,
    workspaceId: ws.id,
    h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" },
  };
}
type User = Awaited<ReturnType<typeof newUser>>;

const post = (u: User, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });
const get = (u: User, url: string) => app.inject({ method: "GET", url, headers: u.h });
const account = (u: User, type: "checking" | "credit_card", name = type) =>
  prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type, name } });

describe("parcelas (n/m) em lançamentos de cartão", () => {
  const manual = (u: User, accountId: string, description: string) =>
    post(u, "/transactions", { type: "expense", amountCents: 1000, date: "2026-06-10", accountId, description });

  it("lançamento manual em cartão extrai a parcela; mês/ano e conta corrente ficam sem parcela", async () => {
    const u = await newUser("parc1");
    const card = await account(u, "credit_card");
    const checking = await account(u, "checking");

    const parcelado = await manual(u, card.id, "LOJA X 03/10");
    const mesAno = await manual(u, card.id, "Netflix 01/2026");
    const corrente = await manual(u, checking.id, "LOJA X 03/10");
    for (const r of [parcelado, mesAno, corrente]) expect(r.statusCode).toBe(201);

    expect(parcelado.json()).toMatchObject({ installmentCurrent: 3, installmentTotal: 10 });
    expect(mesAno.json()).toMatchObject({ installmentCurrent: null, installmentTotal: null });
    expect(corrente.json()).toMatchObject({ installmentCurrent: null, installmentTotal: null });

    const row = await prisma.transaction.findUniqueOrThrow({ where: { id: parcelado.json().id } });
    expect(row).toMatchObject({ installmentCurrent: 3, installmentTotal: 10 });
  });

  it("GET /transactions devolve os campos de revisão e de parcela em cada linha", async () => {
    const u = await newUser("parc2");
    const card = await account(u, "credit_card");
    await manual(u, card.id, "LOJA Y 02/04");

    const res = await get(u, "/transactions");
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      transferPairId: null, ignored: false, categorySource: "none", reviewStatus: "ok",
      installmentCurrent: 2, installmentTotal: 4,
    });
  });

  it("importação OFX em cartão grava a parcela da linha", async () => {
    const u = await newUser("parc3");
    const card = await account(u, "credit_card");
    const ofx = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>077<ACCTID>777-1</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260605<TRNAMT>-35.00<FITID>P1<MEMO>LOJA X 02/05</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260606<TRNAMT>-20.00<FITID>P2<MEMO>Padaria</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const preview = await post(u, "/import/preview", { accountId: card.id, text: ofx, format: "ofx" });
    expect(preview.statusCode).toBe(200);
    const rows = preview.json().rows as Array<Record<string, unknown>>;
    const commit = await post(u, `/import/${preview.json().batchId}/commit`, {
      rows: rows.map((r) => ({
        type: r.type, amountCents: r.amountCents, date: r.date, postedDate: r.postedDate,
        description: r.description, fingerprint: r.fingerprint, accountId: card.id,
      })),
    });
    expect(commit.json()).toEqual({ inserted: 2, skipped: 0 });

    const txs = await prisma.transaction.findMany({ where: { workspaceId: u.workspaceId }, orderBy: { description: "asc" } });
    const loja = txs.find((t) => t.description?.includes("LOJA X"));
    const padaria = txs.find((t) => t.description?.includes("Padaria"));
    expect(loja).toMatchObject({ installmentCurrent: 2, installmentTotal: 5 });
    expect(padaria).toMatchObject({ installmentCurrent: null, installmentTotal: null });
  });
});
