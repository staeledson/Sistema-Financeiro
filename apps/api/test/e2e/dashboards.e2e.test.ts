import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { CardsService } from "../../src/dashboard/cards.service";

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

  it("parcela escrita só na contraparte também é extraída (descrição sem parcela)", async () => {
    const u = await newUser("parc3");
    const card = await account(u, "credit_card");
    const res = await post(u, "/transactions", {
      type: "expense", amountCents: 1000, date: "2026-06-10", accountId: card.id, description: "Compra online", counterparty: "LOJA Z 02/06",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ installmentCurrent: 2, installmentTotal: 6 });
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

const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

async function seedSpending(tag: string) {
  const u = await newUser(tag);
  const pf1 = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "PF1", entity: "pf" } });
  const pj1 = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "PJ1", entity: "pj" } });
  const mercado = await prisma.category.create({ data: { workspaceId: u.workspaceId, type: "expense", name: "Mercado", entity: "both" } });
  const software = await prisma.category.create({ data: { workspaceId: u.workspaceId, type: "expense", name: "Software", entity: "pj" } });
  await prisma.budget.create({ data: { workspaceId: u.workspaceId, method: "fixed", categoryId: mercado.id, limitCents: 20000n } });
  const tx = (data: Record<string, unknown>) =>
    prisma.transaction.create({
      data: { workspaceId: u.workspaceId, type: "expense", source: "manual", createdById: u.userId, ...data } as never,
    });
  await tx({ accountId: pf1.id, categoryId: mercado.id, amountCents: 10000n, date: dayOf("2026-06-05") });
  await tx({ accountId: pf1.id, categoryId: mercado.id, amountCents: 5000n, date: dayOf("2026-06-12") });
  await tx({ accountId: pj1.id, categoryId: software.id, amountCents: 30000n, date: dayOf("2026-06-08"), counterparty: "Software SA" });
  await tx({ accountId: pf1.id, categoryId: mercado.id, amountCents: 99999n, date: dayOf("2026-06-09"), transferPairId: "p" });
  await tx({ accountId: pf1.id, categoryId: mercado.id, amountCents: 8000n, date: dayOf("2026-06-10"), ignored: true });
  await tx({ accountId: pf1.id, categoryId: mercado.id, amountCents: 6000n, date: dayOf("2026-05-07") });
  await tx({ accountId: pj1.id, categoryId: software.id, amountCents: 30000n, date: dayOf("2026-05-08"), counterparty: "Software SA" });
  return { u, pf1, pj1, mercado, software };
}

describe("GET /dashboard/spending", () => {
  it("sem entity: total, categorias, insight, orçamento, contrapartes e série mensal", async () => {
    const { u } = await seedSpending("sp1");
    const res = await get(u, "/dashboard/spending?month=2026-06&asOf=2026-06-20");
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.period).toMatchObject({ kind: "month", from: "2026-06-01", to: "2026-06-30" });
    expect(b.previousPeriod).toMatchObject({ from: "2026-05-01", to: "2026-05-31" });
    expect(b.totalCents).toBe(45000);
    expect(b.previousTotalCents).toBe(36000);
    expect(b.byCategory).toEqual([
      expect.objectContaining({ name: "Software", totalCents: 30000, pct: 67, count: 1, previousCents: 30000 }),
      expect.objectContaining({ name: "Mercado", totalCents: 15000, pct: 33, count: 2, previousCents: 6000 }),
    ]);
    expect(b.insight).toBe("Mercado subiu 150% vs. período anterior");
    expect(b.vsBudget).toEqual([expect.objectContaining({ name: "Mercado", limitCents: 20000, spentCents: 15000, pct: 75 })]);
    expect(b.topCounterparties[0]).toEqual({ name: "Software SA", totalCents: 30000, count: 1 });
    expect(b.byMonth.months).toHaveLength(12);
    expect(b.byMonth.months[11]).toBe("2026-06");
    const serie = (name: string) => b.byMonth.series.find((s: { name: string }) => s.name === name).totalsCents as number[];
    expect(serie("Software").slice(-2)).toEqual([30000, 30000]);
    expect(serie("Mercado").slice(-2)).toEqual([6000, 15000]);
    expect(b.recurring).toEqual([]);
  });

  it("entity=pf, entity=pj e accountId filtram; conta de outro workspace dá 400", async () => {
    const { u, pf1 } = await seedSpending("sp2");
    const other = await seedSpending("sp2b");
    const pf = (await get(u, "/dashboard/spending?month=2026-06&entity=pf")).json();
    expect(pf.totalCents).toBe(15000);
    expect(pf.byCategory.map((c: { name: string; totalCents: number }) => [c.name, c.totalCents])).toEqual([["Mercado", 15000]]);
    const pj = (await get(u, "/dashboard/spending?month=2026-06&entity=pj")).json();
    expect(pj.byCategory.map((c: { name: string }) => c.name)).toEqual(["Software"]);
    const acc = (await get(u, `/dashboard/spending?month=2026-06&accountId=${pf1.id}`)).json();
    expect(acc.byCategory).toEqual(pf.byCategory);
    expect(acc.totalCents).toBe(pf.totalCents);
    const foreign = await get(u, `/dashboard/spending?month=2026-06&accountId=${other.pf1.id}`);
    expect(foreign.statusCode).toBe(400);
  });

  it("trimestre: soma abril-junho, trimestre anterior vazio e limite do orçamento x3", async () => {
    const { u } = await seedSpending("sp3");
    const b = (await get(u, "/dashboard/spending?quarter=2026-Q2&asOf=2026-06-20")).json();
    expect(b.totalCents).toBe(81000);
    expect(b.previousTotalCents).toBe(0);
    expect(b.insight).toBeNull();
    expect(b.vsBudget[0]).toMatchObject({ limitCents: 60000, spentCents: 21000, pct: 35 });
  });

  it("recorrência: assinatura mensal detectada; parcelada não entra", async () => {
    const u = await newUser("sp4");
    const acc = await account(u, "checking");
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", accountId: acc.id, source: "manual", createdById: u.userId, ...data } as never,
      });
    for (const [desc, date] of [["NETFLIX 04/2026", "2026-04-10"], ["NETFLIX 05/2026", "2026-05-10"], ["NETFLIX 06/2026", "2026-06-10"]]) {
      await tx({ description: desc, amountCents: 5590n, date: dayOf(date) });
    }
    for (const date of ["2026-04-12", "2026-05-12", "2026-06-12"]) {
      await tx({ description: "LOJA PARC", amountCents: 3000n, date: dayOf(date), installmentCurrent: 1, installmentTotal: 10 });
    }
    const b = (await get(u, "/dashboard/spending?month=2026-06&asOf=2026-06-20")).json();
    expect(b.recurring).toHaveLength(1);
    expect(b.recurring[0]).toMatchObject({ key: "netflix", frequency: "monthly", monthlyEstimateCents: 5590 });
  });

  it("filtros inválidos viram 400", async () => {
    const u = await newUser("sp5");
    expect((await get(u, "/dashboard/spending?month=2026-13")).statusCode).toBe(400);
    expect((await get(u, "/dashboard/spending?month=2026-06&year=2026")).statusCode).toBe(400);
  });

  it("despesa sem categoria aparece como Sem categoria; parâmetro repetido na query dá 400", async () => {
    const u = await newUser("sp7");
    const acc = await account(u, "checking");
    await prisma.transaction.create({
      data: { workspaceId: u.workspaceId, type: "expense", accountId: acc.id, source: "manual", createdById: u.userId, amountCents: 4200n, date: dayOf("2026-06-05"), description: "Sem classificar" } as never,
    });
    const b = (await get(u, "/dashboard/spending?month=2026-06")).json();
    expect(b.totalCents).toBe(4200);
    expect(b.byCategory).toEqual([expect.objectContaining({ name: "Sem categoria", totalCents: 4200, pct: 100, count: 1 })]);
    expect((await get(u, "/dashboard/spending?month=2026-06&month=2026-07")).statusCode).toBe(400);
  });

  it("parâmetros vazios são ignorados", async () => {
    const u = await newUser("sp6");
    const res = await get(u, "/dashboard/spending?month=2026-06&entity=&accountId=");
    expect(res.statusCode).toBe(200);
    expect(res.json().totalCents).toBe(0);
  });
});

describe("GET /transactions (paridade com os dashboards: type, reportable e __none)", () => {
  async function seedList(tag: string) {
    const { u, pf1, mercado } = await seedSpending(tag);
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", source: "manual", createdById: u.userId, ...data } as never,
      });
    await tx({ accountId: pf1.id, amountCents: 1111n, date: dayOf("2026-06-15"), description: "sem cat normal" });
    await tx({ accountId: pf1.id, amountCents: 2222n, date: dayOf("2026-06-16"), description: "sem cat pareada", transferPairId: "p2" });
    await tx({ accountId: pf1.id, amountCents: 3333n, date: dayOf("2026-06-17"), description: "sem cat ignorada", ignored: true });
    await tx({ accountId: pf1.id, type: "income", amountCents: 4444n, date: dayOf("2026-06-18"), description: "sem cat receita" });
    return { u, mercado };
  }
  const descs = (res: { json: () => unknown }) => (res.json() as Array<{ description: string | null }>).map((r) => r.description);

  it("categoryId=__none + type=expense + reportable=1 devolve só a despesa sem categoria que entra no dashboard", async () => {
    const { u } = await seedList("ls1");
    const res = await get(u, "/transactions?categoryId=__none&type=expense&reportable=1&from=2026-06-01&to=2026-06-30");
    expect(res.statusCode).toBe(200);
    expect(descs(res)).toEqual(["sem cat normal"]);
    const spending = (await get(u, "/dashboard/spending?month=2026-06")).json();
    const none = spending.byCategory.find((c: { categoryId: string }) => c.categoryId === "__none");
    expect(none.totalCents).toBe(1111);
    expect(none.count).toBe(1);
  });

  it("sem reportable, __none lista também pareadas e ignoradas (todas sem categoria, qualquer tipo)", async () => {
    const { u } = await seedList("ls2");
    const res = await get(u, "/transactions?categoryId=__none&from=2026-06-01&to=2026-06-30");
    expect(descs(res).sort()).toEqual(["sem cat ignorada", "sem cat normal", "sem cat pareada", "sem cat receita"]);
  });

  it("categoria normal + reportable=1 exclui a linha pareada e a ignorada da mesma categoria", async () => {
    const { u, mercado } = await seedList("ls3");
    const all = await get(u, `/transactions?categoryId=${mercado.id}&type=expense&from=2026-06-01&to=2026-06-30`);
    expect(all.json()).toHaveLength(4);
    const rep = await get(u, `/transactions?categoryId=${mercado.id}&type=expense&reportable=1&from=2026-06-01&to=2026-06-30`);
    expect((rep.json() as Array<{ amountCents: number }>).map((r) => Number(r.amountCents)).sort((a, b) => a - b)).toEqual([5000, 10000]);
    const spending = (await get(u, "/dashboard/spending?month=2026-06")).json();
    expect(spending.byCategory.find((c: { name: string }) => c.name === "Mercado").totalCents).toBe(15000);
  });

  it("type filtra por tipo; valores inválidos e reportable sem type income/expense dão 400", async () => {
    const { u } = await seedList("ls4");
    const rec = await get(u, "/transactions?type=income");
    expect(descs(rec)).toEqual(["sem cat receita"]);
    expect((await get(u, "/transactions?type=xx")).statusCode).toBe(400);
    expect((await get(u, "/transactions?reportable=1")).statusCode).toBe(400);
    expect((await get(u, "/transactions?reportable=1&type=transfer")).statusCode).toBe(400);
    expect((await get(u, "/transactions?reportable=sim&type=expense")).statusCode).toBe(400);
    expect((await get(u, "/transactions?reportable=1&type=income")).statusCode).toBe(200);
    expect((await get(u, "/transactions?type=&reportable=")).statusCode).toBe(200);
  });
});

describe("GET /balances (SQL, com entidade)", () => {
  async function seedBalances(tag: string) {
    const u = await newUser(tag);
    const pf1 = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "PF1", entity: "pf", openingBalanceCents: 100000n } });
    const pj1 = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "PJ1", entity: "pj", openingBalanceCents: 50000n } });
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, source: "manual", createdById: u.userId, date: dayOf("2026-06-05"), ...data } as never });
    await tx({ type: "income", accountId: pf1.id, amountCents: 200000n });
    await tx({ type: "expense", accountId: pf1.id, amountCents: 50000n });
    await tx({ type: "expense", accountId: pf1.id, amountCents: 30000n, transferPairId: "par" });
    await tx({ type: "income", accountId: pj1.id, amountCents: 30000n, transferPairId: "par" });
    await tx({ type: "expense", accountId: pf1.id, amountCents: 7000n, ignored: true });
    await tx({ type: "transfer", sourceAccountId: pf1.id, destAccountId: pj1.id, amountCents: 400n, date: dayOf("2026-07-01") });
    return { u, pf1, pj1 };
  }

  // PF1: 100000 + 200000 - 50000 - 30000 (par) - 7000 (ignorado) - 400 (transferência) = 212600; PJ1: 50000 + 30000 (par) + 400 = 80400
  it("mantém o contrato e inclui pares e ignorados no saldo", async () => {
    const { u, pf1, pj1 } = await seedBalances("bal1");
    const body = (await get(u, "/balances")).json();
    expect(body.accounts).toEqual([
      { accountId: pf1.id, name: "PF1", type: "checking", balanceCents: 212600 },
      { accountId: pj1.id, name: "PJ1", type: "checking", balanceCents: 80400 },
    ]);
    expect(body.consolidatedCents).toBe(293000);
    expect(body.cardsCents).toBe(0);
  });

  // O saldo do cartão é dívida futura (passivo), não caixa: fica fora do consolidado e vai para `cardsCents`.
  it("consolidatedCents exclui cartões de crédito; cardsCents traz a dívida e a conta do cartão continua na lista", async () => {
    const u = await newUser("bal-card");
    const mk = (data: Record<string, unknown>) =>
      prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, entity: "pf", ...data } as never });
    const cc = await mk({ type: "checking", name: "Corrente", openingBalanceCents: 100000n });
    const card = await mk({ type: "credit_card", name: "Cartão", openingBalanceCents: -30000n });
    const body = (await get(u, "/balances")).json();
    expect(body.accounts).toEqual([
      { accountId: cc.id, name: "Corrente", type: "checking", balanceCents: 100000 },
      { accountId: card.id, name: "Cartão", type: "credit_card", balanceCents: -30000 },
    ]);
    expect(body.consolidatedCents).toBe(100000);
    expect(body.cardsCents).toBe(-30000);
    const only = (await get(u, `/balances?accountId=${card.id}`)).json();
    expect(only.accounts).toHaveLength(1);
    expect(only.consolidatedCents).toBe(0);
    expect(only.cardsCents).toBe(-30000);
  });

  it("entity, accountId e asOf restringem o resultado", async () => {
    const { u, pf1 } = await seedBalances("bal2");
    const pf = (await get(u, "/balances?entity=pf")).json();
    expect(pf.accounts.map((a: { name: string }) => a.name)).toEqual(["PF1"]);
    expect(pf.consolidatedCents).toBe(212600);
    const pj = (await get(u, "/balances?entity=pj")).json();
    expect(pj.consolidatedCents).toBe(80400);
    const one = (await get(u, `/balances?accountId=${pf1.id}`)).json();
    expect(one.consolidatedCents).toBe(212600);
    // a transferência de 400 é de julho: antes dela PF1 = 100000 + 200000 - 50000 - 30000 - 7000 = 213000
    const antes = (await get(u, "/balances?entity=pf&asOf=2026-06-30")).json();
    expect(antes.consolidatedCents).toBe(213000);
    expect((await get(u, "/balances?entity=xx")).statusCode).toBe(400);
  });

  it("conta arquivada fica de fora e conta de outro workspace dá 400", async () => {
    const { u, pj1 } = await seedBalances("bal3");
    const other = await seedBalances("bal3b");
    await prisma.bankAccount.update({ where: { id: pj1.id }, data: { archived: true } });
    const body = (await get(u, "/balances")).json();
    expect(body.accounts).toHaveLength(1);
    expect((await get(u, `/balances?accountId=${other.pf1.id}`)).statusCode).toBe(400);
  });
});

describe("GET /dashboard/cards", () => {
  async function seedCard(tag: string) {
    const u = await newUser(tag);
    const card = await prisma.bankAccount.create({
      data: {
        workspaceId: u.workspaceId, type: "credit_card", name: "Cartão", entity: "pf",
        closingDay: 10, dueDay: 17, creditLimitCents: 500000n, openingBalanceCents: 0n,
      },
    });
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({
        data: { workspaceId: u.workspaceId, accountId: card.id, source: "manual", createdById: u.userId, ...data } as never,
      });
    await tx({ type: "expense", amountCents: 10000n, date: dayOf("2026-06-12"), description: "MERCADO" });
    await tx({
      type: "expense", amountCents: 20000n, date: dayOf("2026-06-15"), description: "LOJA X 02/10",
      installmentCurrent: 2, installmentTotal: 10,
    });
    await tx({ type: "income", amountCents: 3000n, date: dayOf("2026-06-18"), description: "Estorno" });
    await tx({ type: "expense", amountCents: 40000n, date: dayOf("2026-05-20"), description: "Compra maio" });
    await tx({ type: "income", amountCents: 40000n, date: dayOf("2026-06-14"), description: "Pagamento fatura", transferPairId: "pp" });
    return { u, card, tx };
  }
  const AS_OF = "asOf=2026-06-20";

  it("fatura aberta, limite usado, ciclo diário, parcelas e pagamentos (valores calculados à mão)", async () => {
    const { u, card } = await seedCard("cd1");
    const res = await get(u, `/dashboard/cards?${AS_OF}`);
    expect(res.statusCode).toBe(200);
    const { cards } = res.json();
    expect(cards).toHaveLength(1);
    const c = cards[0];
    expect(c).toMatchObject({
      accountId: card.id, name: "Cartão", entity: "pf", configured: true, closingDay: 10, dueDay: 17,
      creditLimitCents: 500000, usedCents: 27000, limitUsedPct: 5.4,
      openInvoiceCents: 27000, closingDate: "2026-07-10", dueDate: "2026-07-17",
    });

    // ciclo aberto: 11/06 (dia 1) a 10/07; o maior ciclo recente tem 31 dias
    expect(c.cycleDaily).toHaveLength(31);
    const day = (n: number) => c.cycleDaily[n - 1];
    expect(day(1).currentCents).toBe(0);
    expect(day(2).currentCents).toBe(10000);
    expect(day(5).currentCents).toBe(30000);
    expect(day(8).currentCents).toBe(27000);
    expect(day(10).currentCents).toBe(27000); // 20/06 = asOf
    expect(day(11).currentCents).toBeNull();
    expect(day(31).currentCents).toBeNull();
    for (const d of c.cycleDaily) expect(typeof d.avgPreviousCents).toBe("number");
    // média dos 3 ciclos fechados (abr, mai, jun): só o de junho teve compra (40000 no dia 10)
    expect(day(9).avgPreviousCents).toBe(0);
    expect(day(10).avgPreviousCents).toBe(13333);
    expect(day(31).avgPreviousCents).toBe(13333);

    // meses de vencimento, 12 a partir de jul/26: a 2/10 já lançada (15/06, fatura que vence 17/07) + parcelas 3 a 10 (ago/26 a mar/27)
    expect(c.installmentsAhead).toHaveLength(12);
    expect(c.installmentsAhead.map((e: { month: string }) => e.month)[0]).toBe("2026-07");
    expect(c.installmentsAhead[11].month).toBe("2027-06");
    expect(c.installmentsAhead.slice(0, 9)).toEqual(
      ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"].map((month) => ({ month, amountCents: 20000, count: 1 })),
    );
    expect(c.installmentsAhead.slice(9)).toEqual(
      ["2027-04", "2027-05", "2027-06"].map((month) => ({ month, amountCents: 0, count: 0 })),
    );

    expect(c.invoicePayments).toEqual([
      { closing: "2026-06-10", due: "2026-06-17", invoiceCents: 40000, paidCents: 40000, status: "paid" },
    ]);
  });

  it("fatura vencida sem pagamento é overdue e pagamento menor que a fatura é partial", async () => {
    const u = await newUser("cd2");
    const mk = (name: string) =>
      prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name, closingDay: 10, dueDay: 17 } });
    const a = await mk("A");
    const b = await mk("B");
    const tx = (accountId: string, data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, accountId, source: "manual", createdById: u.userId, ...data } as never });
    await tx(a.id, { type: "expense", amountCents: 40000n, date: dayOf("2026-05-20") });
    await tx(b.id, { type: "expense", amountCents: 40000n, date: dayOf("2026-05-20") });
    await tx(b.id, { type: "income", amountCents: 15000n, date: dayOf("2026-06-14"), transferPairId: "q" });
    const { cards } = (await get(u, `/dashboard/cards?${AS_OF}`)).json();
    const byName = (n: string) => cards.find((c: { name: string }) => c.name === n);
    expect(byName("A").invoicePayments).toEqual([
      { closing: "2026-06-10", due: "2026-06-17", invoiceCents: 40000, paidCents: 0, status: "overdue" },
    ]);
    expect(byName("B").invoicePayments).toEqual([
      { closing: "2026-06-10", due: "2026-06-17", invoiceCents: 40000, paidCents: 15000, status: "partial" },
    ]);
    // antes do vencimento (asOf 15/06) a mesma fatura sem pagamento ainda está aberta
    const early = (await get(u, `/dashboard/cards?accountId=${a.id}&asOf=2026-06-15`)).json();
    expect(early.cards[0].invoicePayments[0]).toMatchObject({ invoiceCents: 40000, paidCents: 0, status: "open" });
  });

  it("pagamento só conta até o fechamento seguinte e até asOf", async () => {
    const u = await newUser("cd3");
    const card = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "C", closingDay: 10, dueDay: 17 } });
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, accountId: card.id, source: "manual", createdById: u.userId, ...data } as never });
    await tx({ type: "expense", amountCents: 10000n, date: dayOf("2026-04-20") }); // fatura de 10/05
    await tx({ type: "income", amountCents: 10000n, date: dayOf("2026-05-12"), transferPairId: "a" }); // paga a de 10/05
    await tx({ type: "income", amountCents: 7000n, date: dayOf("2026-06-12"), transferPairId: "b" }); // fora da janela da de 10/05
    await tx({ type: "income", amountCents: 9999n, date: dayOf("2026-06-25"), transferPairId: "c" }); // depois de asOf
    const { cards } = (await get(u, `/dashboard/cards?${AS_OF}`)).json();
    expect(cards[0].invoicePayments).toEqual([
      { closing: "2026-05-10", due: "2026-05-17", invoiceCents: 10000, paidCents: 10000, status: "paid" },
      { closing: "2026-06-10", due: "2026-06-17", invoiceCents: 0, paidCents: 7000, status: "paid" },
    ]);
  });

  it("cartão sem fechamento/vencimento aparece como não configurado", async () => {
    const u = await newUser("cd4");
    await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "Sem dia", creditLimitCents: 100000n } });
    const { cards } = (await get(u, `/dashboard/cards?${AS_OF}`)).json();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      name: "Sem dia", configured: false, openInvoiceCents: null, closingDate: null, dueDate: null,
      cycleDaily: [], installmentsAhead: [], invoicePayments: [], usedCents: 0, limitUsedPct: 0,
    });
  });

  it("entity e accountId filtram; período não restringe; conta de outro workspace dá 400; só cartões não arquivados", async () => {
    const { u, card } = await seedCard("cd5");
    const other = await seedCard("cd5b");
    const pj = await prisma.bankAccount.create({
      data: { workspaceId: u.workspaceId, type: "credit_card", name: "Cartão PJ", entity: "pj", closingDay: 5, dueDay: 12 },
    });
    await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "Corrente" } });
    await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "Velho", archived: true, closingDay: 1, dueDay: 8 } });

    const names = async (q: string) =>
      ((await get(u, `/dashboard/cards?${AS_OF}${q}`)).json().cards as Array<{ name: string }>).map((c) => c.name);
    expect(await names("")).toEqual(["Cartão", "Cartão PJ"]);
    expect(await names("&entity=pj")).toEqual(["Cartão PJ"]);
    expect(await names("&entity=pf")).toEqual(["Cartão"]);
    expect(await names(`&accountId=${pj.id}`)).toEqual(["Cartão PJ"]);
    // o período do filtro não muda a fatura aberta
    const jan = (await get(u, `/dashboard/cards?${AS_OF}&month=2026-01&accountId=${card.id}`)).json();
    expect(jan.cards[0].openInvoiceCents).toBe(27000);
    expect((await get(u, `/dashboard/cards?${AS_OF}&accountId=${other.card.id}`)).statusCode).toBe(400);
    expect((await get(u, `/dashboard/cards?entity=xx`)).statusCode).toBe(400);
  });

  it("lançamentos ignorados não entram na fatura, no ciclo diário nem nas parcelas", async () => {
    const { u, tx } = await seedCard("cd6");
    await tx({ type: "expense", amountCents: 5000n, date: dayOf("2026-06-13"), ignored: true, description: "Duplicada" });
    await tx({
      type: "expense", amountCents: 9000n, date: dayOf("2026-06-13"), ignored: true, description: "LOJA IGN 01/05",
      installmentCurrent: 1, installmentTotal: 5,
    });
    const c = (await get(u, `/dashboard/cards?${AS_OF}`)).json().cards[0];
    expect(c.openInvoiceCents).toBe(27000);
    expect(c.cycleDaily[2].currentCents).toBe(10000); // dia 3 (13/06) continua igual ao dia 2
    expect(c.installmentsAhead.slice(0, 9).every((e: { amountCents: number }) => e.amountCents === 20000)).toBe(true);
  });

  it("identidade da parcela: 10/10 antiga não esconde a série nova e compras simultâneas com totais diferentes ficam separadas", async () => {
    const u = await newUser("cd7");
    const card = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "C", closingDay: 10, dueDay: 17 } });
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, accountId: card.id, type: "expense", source: "manual", createdById: u.userId, ...data } as never });
    // série antiga terminada (fev) e série nova (jun) da mesma loja
    await tx({ amountCents: 10000n, date: dayOf("2026-02-15"), description: "AMAZON 10/10", installmentCurrent: 10, installmentTotal: 10 });
    await tx({ amountCents: 30000n, date: dayOf("2026-06-15"), description: "AMAZON 02/06", installmentCurrent: 2, installmentTotal: 6 });
    // duas compras simultâneas na mesma loja, totais diferentes
    await tx({ amountCents: 1000n, date: dayOf("2026-06-12"), description: "FARMACIA 01/02", installmentCurrent: 1, installmentTotal: 2 });
    await tx({ amountCents: 2000n, date: dayOf("2026-06-12"), description: "FARMACIA 01/03", installmentCurrent: 1, installmentTotal: 3 });
    const c = (await get(u, `/dashboard/cards?${AS_OF}`)).json().cards[0];
    const amounts = c.installmentsAhead.map((e: { amountCents: number }) => e.amountCents);
    // jul/26: 30000 (2/6 lançada) + 1000 + 2000 (1as parcelas lançadas); ago: 30000 + 1000 + 2000; set: 30000 + 2000; out e nov: 30000 (3..6 = ago..nov)
    expect(amounts.slice(0, 6)).toEqual([33000, 33000, 32000, 30000, 30000, 0]);
    expect(c.installmentsAhead[0].count).toBe(3);
    expect(c.installmentsAhead[2].count).toBe(2);
  });

  it("parcela escrita só na contraparte agrupa pela contraparte", async () => {
    const u = await newUser("cd8");
    const card = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "C", closingDay: 10, dueDay: 17 } });
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, accountId: card.id, type: "expense", source: "manual", createdById: u.userId, amountCents: 5000n,
        date: dayOf("2026-06-15"), description: "Compra online", counterparty: "LOJA Z 02/04", installmentCurrent: 2, installmentTotal: 4,
      } as never,
    });
    const c = (await get(u, `/dashboard/cards?${AS_OF}`)).json().cards[0];
    expect(c.installmentsAhead.slice(0, 4).map((e: { amountCents: number }) => e.amountCents)).toEqual([5000, 5000, 5000, 0]);
  });

  it("vencimento no mês seguinte ao fechamento (fecha 25, vence 5): parcelas por mês de vencimento", async () => {
    const u = await newUser("cd9");
    const card = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "C", closingDay: 25, dueDay: 5 } });
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, accountId: card.id, type: "expense", source: "manual", createdById: u.userId, amountCents: 8000n,
        date: dayOf("2026-06-15"), description: "LOJA W 02/04", installmentCurrent: 2, installmentTotal: 4,
      } as never,
    });
    // asOf 20/06: ciclo aberto fecha 25/06 e vence 05/07; parcelas 3 e 4 caem nos ciclos que fecham em jul e ago (vencem em ago e set)
    const c = (await get(u, `/dashboard/cards?${AS_OF}`)).json().cards[0];
    expect(c).toMatchObject({ closingDate: "2026-06-25", dueDate: "2026-07-05" });
    expect(c.installmentsAhead.slice(0, 4)).toEqual([
      { month: "2026-07", amountCents: 8000, count: 1 }, // a 2/4 já lançada, paga no vencimento de 05/07
      { month: "2026-08", amountCents: 8000, count: 1 },
      { month: "2026-09", amountCents: 8000, count: 1 },
      { month: "2026-10", amountCents: 0, count: 0 },
    ]);
  });

  it("remainingInstallmentsMonthly: só as parcelas ainda não lançadas, por mês da data da última + k, 12 meses fixos", async () => {
    const { u } = await seedCard("cd10"); // cartão A (fecha 10): 2/10 lançada em 15/06 (depois do fechamento); restam 3..10 em jul/26 a fev/27
    const b = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "B", entity: "pj", closingDay: 25, dueDay: 5 } });
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, accountId: b.id, type: "expense", source: "manual", createdById: u.userId, amountCents: 8000n,
        date: dayOf("2026-06-15"), description: "LOJA W 02/04", installmentCurrent: 2, installmentTotal: 4,
      } as never,
    });
    // cartão B (fecha 25): 2/4 lançada em 15/06; restam 3 e 4 em jul e ago
    const service = app.get(CardsService, { strict: false });
    const all = await service.remainingInstallmentsMonthly(u.workspaceId, {}, "2026-06-20");
    expect(all).toHaveLength(12);
    expect(all[0].month).toBe("2026-07");
    expect(all[11].month).toBe("2027-06");
    expect(all.slice(0, 4)).toEqual([
      { month: "2026-07", amountCents: 28000 }, // 3/10 do cartão A (comprado após o fechamento, mas na data de jul) + 3/4 do B
      { month: "2026-08", amountCents: 28000 },
      { month: "2026-09", amountCents: 20000 },
      { month: "2026-10", amountCents: 20000 },
    ]);
    expect(all.slice(7, 12).map((e) => e.amountCents)).toEqual([20000, 0, 0, 0, 0]); // 2027-02 é a última (parcela 10/10)
    const pj = await service.remainingInstallmentsMonthly(u.workspaceId, { entity: "pj" }, "2026-06-20");
    expect(pj).toHaveLength(12);
    expect(pj.slice(0, 4).map((e) => e.amountCents)).toEqual([8000, 8000, 0, 0]);
    // o endpoint do cartão continua incluindo a parcela já lançada, por mês de vencimento
    const card = (await get(u, `/dashboard/cards?${AS_OF}&entity=pj`)).json().cards[0];
    expect(card.installmentsAhead.slice(0, 3).map((e: { amountCents: number }) => e.amountCents)).toEqual([8000, 8000, 8000]);
  });
});

async function seedCashflow(tag: string) {
  const u = await newUser(tag);
  const pf1 = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "PF1", entity: "pf", openingBalanceCents: 100000n } });
  const pj1 = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "PJ1", entity: "pj", openingBalanceCents: 50000n } });
  const tx = (data: Record<string, unknown>) =>
    prisma.transaction.create({ data: { workspaceId: u.workspaceId, source: "manual", createdById: u.userId, date: dayOf("2026-06-05"), ...data } as never });
  await tx({ type: "income", accountId: pf1.id, amountCents: 200000n });
  await tx({ type: "expense", accountId: pf1.id, amountCents: 50000n });
  await tx({ type: "expense", accountId: pf1.id, amountCents: 30000n, transferPairId: "p1" });
  await tx({ type: "income", accountId: pj1.id, amountCents: 30000n, transferPairId: "p1" });
  await tx({ type: "income", accountId: pj1.id, amountCents: 100000n });
  await tx({ type: "expense", accountId: pj1.id, amountCents: 20000n });
  await prisma.scheduledBill.create({
    data: { workspaceId: u.workspaceId, name: "Internet", amountCents: 10000n, dueDate: dayOf("2026-07-05"), recurrence: "monthly", createdById: u.userId },
  });
  return { u, pf1, pj1, tx };
}

describe("GET /dashboard/cashflow", () => {
  const AS_OF = "asOf=2026-06-20";
  const sum = (accounts: Array<{ balanceCents: number }>) => accounts.reduce((s, a) => s + a.balanceCents, 0);

  // PF1: 100000 + 200000 - 50000 - 30000 (par) = 220000; PJ1: 50000 + 30000 (par) + 100000 - 20000 = 160000
  it("sem entity: consolidado, 12 meses (junho com receita/despesa sem pares) e previsão de 3 meses", async () => {
    const { u } = await seedCashflow("cf1");
    const res = await get(u, `/dashboard/cashflow?${AS_OF}`);
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.balances.consolidated).toEqual({ pfCents: 220000, pjCents: 160000, totalCents: 380000 });
    expect(b.balances.cards).toEqual({ pfCents: 0, pjCents: 0, totalCents: 0 });
    expect(b.balances.accounts.map((a: { name: string; balanceCents: number }) => [a.name, a.balanceCents])).toEqual([["PF1", 220000], ["PJ1", 160000]]);
    expect(b.balances.accounts[0]).toMatchObject({ type: "checking", entity: "pf" });

    expect(b.monthly).toHaveLength(12);
    expect(b.monthly[0].month).toBe("2025-07");
    expect(b.monthly[11]).toEqual({ month: "2026-06", incomeCents: 300000, expenseCents: 70000, transfersNetCents: 0, balanceCents: 380000 });
    for (const m of b.monthly.slice(0, 11)) {
      expect(m).toEqual({ month: m.month, incomeCents: 0, expenseCents: 0, transfersNetCents: 0, balanceCents: 150000 });
    }

    expect(b.forecast.map((f: { month: string }) => f.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    for (const f of b.forecast) expect(f).toMatchObject({ incomeCents: 0, recurringCents: 0, installmentsCents: 0, billsCents: 10000, expenseCents: 10000 });
    expect(b.forecast.map((f: { balanceCents: number }) => f.balanceCents)).toEqual([370000, 360000, 350000]);
  });

  it("entity=pj e entity=pf: junho do escopo com transferência líquida; consolidado não muda", async () => {
    const { u, pf1 } = await seedCashflow("cf2");
    const all = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    const pj = (await get(u, `/dashboard/cashflow?${AS_OF}&entity=pj`)).json();
    const pf = (await get(u, `/dashboard/cashflow?${AS_OF}&entity=pf`)).json();
    expect(pj.monthly[11]).toEqual({ month: "2026-06", incomeCents: 100000, expenseCents: 20000, transfersNetCents: 30000, balanceCents: 160000 });
    expect(pf.monthly[11]).toEqual({ month: "2026-06", incomeCents: 200000, expenseCents: 50000, transfersNetCents: -30000, balanceCents: 220000 });
    expect(pj.monthly[0].balanceCents).toBe(50000);
    expect(pf.monthly[0].balanceCents).toBe(100000);
    expect(pj.balances.accounts.map((a: { name: string }) => a.name)).toEqual(["PJ1"]);
    expect(pf.balances.accounts.map((a: { name: string }) => a.name)).toEqual(["PF1"]);
    expect(pj.balances.consolidated).toEqual(all.balances.consolidated);
    expect(pf.balances.consolidated).toEqual(all.balances.consolidated);
    expect(pj.balances.cards).toEqual(all.balances.cards);
    // a previsão parte do saldo do escopo
    expect(pj.forecast.map((f: { balanceCents: number }) => f.balanceCents)).toEqual([150000, 140000, 130000]);

    const acc = (await get(u, `/dashboard/cashflow?${AS_OF}&accountId=${pf1.id}`)).json();
    expect(acc.monthly[11]).toEqual(pf.monthly[11]);
    expect(acc.balances.consolidated).toEqual(all.balances.consolidated);
  });

  it("o saldo do último mês bate com a soma dos saldos do escopo (inclui ignorados e transferências)", async () => {
    const { u, pf1, pj1, tx } = await seedCashflow("cf3");
    await tx({ type: "expense", accountId: pf1.id, amountCents: 7000n, ignored: true, date: dayOf("2026-05-15") });
    await tx({ type: "transfer", sourceAccountId: pf1.id, destAccountId: pj1.id, amountCents: 400n, date: dayOf("2026-06-10") });
    await tx({ type: "expense", accountId: pf1.id, amountCents: 9999n, date: dayOf("2026-06-25") }); // depois de asOf: fora
    for (const q of ["", "&entity=pf", "&entity=pj", `&accountId=${pj1.id}`]) {
      const b = (await get(u, `/dashboard/cashflow?${AS_OF}${q}`)).json();
      expect(b.monthly[11].balanceCents).toBe(sum(b.balances.accounts));
    }
    const pf = (await get(u, `/dashboard/cashflow?${AS_OF}&entity=pf`)).json();
    // maio: só o ignorado (-7000): 100000 -> 93000; junho: +200000 -50000 -30000 -400
    expect(pf.monthly[10]).toMatchObject({ month: "2026-05", incomeCents: 0, expenseCents: 0, balanceCents: 93000 });
    // transferência manual PF→PJ de 400: -400 para PF, +400 para PJ, 0 no total
    expect(pf.monthly[11]).toMatchObject({ incomeCents: 200000, expenseCents: 50000, transfersNetCents: -30400, balanceCents: 212600 });
    const pj = (await get(u, `/dashboard/cashflow?${AS_OF}&entity=pj`)).json();
    expect(pj.monthly[11]).toMatchObject({ incomeCents: 100000, expenseCents: 20000, transfersNetCents: 30400 });
    const all = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    expect(all.monthly[11]).toMatchObject({ incomeCents: 300000, expenseCents: 70000, transfersNetCents: 0 });
    // a conta isolada vê a transferência cruzando a fronteira; uma transferência entre contas do mesmo escopo vale 0
    const pj2 = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "PJ2", entity: "pj" } });
    await tx({ type: "transfer", sourceAccountId: pj1.id, destAccountId: pj2.id, amountCents: 700n, date: dayOf("2026-06-11") });
    expect((await get(u, `/dashboard/cashflow?${AS_OF}&entity=pj`)).json().monthly[11].transfersNetCents).toBe(30400);
    expect((await get(u, `/dashboard/cashflow?${AS_OF}&accountId=${pj1.id}`)).json().monthly[11].transfersNetCents).toBe(30400 - 700);
  });

  it("movimento anterior à janela de 12 meses entra no saldo de abertura da série", async () => {
    const { u, pf1, tx } = await seedCashflow("cf4");
    await tx({ type: "income", accountId: pf1.id, amountCents: 5000n, date: dayOf("2025-03-01") });
    const b = (await get(u, `/dashboard/cashflow?${AS_OF}&entity=pf`)).json();
    expect(b.monthly[0]).toMatchObject({ month: "2025-07", incomeCents: 0, balanceCents: 105000 });
    expect(b.monthly[11].balanceCents).toBe(225000);
  });

  it("previsão: recorrência detectada entra em recurringCents e a conta agendada equivalente não conta em dobro", async () => {
    const u = await newUser("cf5");
    const acc = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "C", openingBalanceCents: 500000n } });
    for (const date of ["2026-04-10", "2026-05-10", "2026-06-10"]) {
      await prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", accountId: acc.id, source: "manual", createdById: u.userId, amountCents: 100000n, date: dayOf(date), description: "Aluguel" } as never,
      });
    }
    const bill = (name: string, amountCents: bigint, dueDate: string) =>
      prisma.scheduledBill.create({ data: { workspaceId: u.workspaceId, name, amountCents, dueDate: dayOf(dueDate), recurrence: "monthly", createdById: u.userId } });
    await bill("Aluguel", 100000n, "2026-07-10");
    await bill("Internet", 10000n, "2026-07-05");
    await prisma.scheduledBill.create({
      data: { workspaceId: u.workspaceId, name: "Inativa", amountCents: 99999n, dueDate: dayOf("2026-07-01"), recurrence: "monthly", active: false, createdById: u.userId },
    });

    const b = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    // saldo atual: 500000 - 300000 = 200000; histórico (dez a mai): despesa média 33333, menos a recorrência de 100000 => variável 0
    for (const f of b.forecast) expect(f).toMatchObject({ incomeCents: 0, variableCents: 0, recurringCents: 100000, billsCents: 10000, installmentsCents: 0, expenseCents: 110000 });
    expect(b.forecast.map((f: { balanceCents: number }) => f.balanceCents)).toEqual([90000, -20000, -130000]);
  });

  it("previsão: receita e despesa médias dos 6 meses fechados anteriores", async () => {
    const u = await newUser("cf6");
    const acc = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "C" } });
    const tx = (type: string, amountCents: bigint, date: string) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, type, accountId: acc.id, source: "manual", createdById: u.userId, amountCents, date: dayOf(date), description: `x${date}${type}` } as never });
    await tx("income", 120000n, "2026-03-03"); // dentro dos 6 meses (dez a mai)
    await tx("income", 60000n, "2025-12-03");
    await tx("income", 900000n, "2026-06-03"); // junho (mês corrente) não entra na média
    await tx("expense", 30000n, "2026-01-08");
    await tx("expense", 12000n, "2026-05-08");
    await tx("expense", 777000n, "2025-11-08"); // antes da janela de 6 meses
    const b = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    // receita (120000 + 60000) / 6 = 30000; despesa (30000 + 12000) / 6 = 7000, sem recorrentes nem parcelas
    expect(b.forecast[0]).toMatchObject({ incomeCents: 30000, variableCents: 7000, recurringCents: 0, expenseCents: 7000 });
    // saldo atual: 120000 + 60000 + 900000 - 30000 - 12000 - 777000 = 261000; +23000 por mês
    expect(b.forecast.map((f: { balanceCents: number }) => f.balanceCents)).toEqual([284000, 307000, 330000]);
  });

  it("previsão: parcela futura do cartão entra em installmentsCents do mês da data", async () => {
    const u = await newUser("cf7");
    await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "Corrente" } });
    const card = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "Cartão", closingDay: 10, dueDay: 17 } });
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, accountId: card.id, type: "expense", source: "manual", createdById: u.userId, amountCents: 20000n,
        date: dayOf("2026-06-15"), description: "LOJA X 02/04", installmentCurrent: 2, installmentTotal: 4,
      } as never,
    });
    const b = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    // a 2/4 (15/06) é despesa de junho, mas o saldo é CAIXA (o cartão fica fora): o caixa atual é 0 e a dívida de -20000
    // só sai do caixa quando a fatura for paga. Faltam 3/4 e 4/4, nas datas de jul e ago
    expect(b.forecast.map((f: { installmentsCents: number }) => f.installmentsCents)).toEqual([20000, 20000, 0]);
    expect(b.forecast.map((f: { expenseCents: number }) => f.expenseCents)).toEqual([20000, 20000, 0]);
    expect(b.forecast.map((f: { balanceCents: number }) => f.balanceCents)).toEqual([-20000, -40000, -40000]);
    expect(b.monthly[11]).toMatchObject({ month: "2026-06", expenseCents: 20000, balanceCents: 0 });
    expect(b.balances.cards.totalCents).toBe(-20000);
  });

  // Corrente PF (+100000 de abertura, +50000 de receita em junho) e cartão PF (-30000 de abertura, -20000 de compra em junho).
  async function seedWithCard(tag: string) {
    const u = await newUser(tag);
    const mk = (data: Record<string, unknown>) =>
      prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, entity: "pf", ...data } as never });
    const chk = await mk({ type: "checking", name: "Corrente", openingBalanceCents: 100000n });
    const card = await mk({ type: "credit_card", name: "Cartão", openingBalanceCents: -30000n, closingDay: 10, dueDay: 17 });
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, source: "manual", createdById: u.userId, date: dayOf("2026-06-05"), ...data } as never });
    return { u, chk, card, tx };
  }

  it("cartão fica fora do saldo em contas: consolidado e série mensal são caixa, `cards` traz a dívida", async () => {
    const { u, chk, card, tx } = await seedWithCard("cf-card1");
    await tx({ type: "income", accountId: chk.id, amountCents: 50000n });
    await tx({ type: "expense", accountId: card.id, amountCents: 20000n });
    const b = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    expect(b.balances.consolidated).toEqual({ pfCents: 150000, pjCents: 0, totalCents: 150000 });
    expect(b.balances.cards).toEqual({ pfCents: -50000, pjCents: 0, totalCents: -50000 });
    // a lista por conta traz o cartão com o próprio saldo (negativo)
    expect(b.balances.accounts.map((a: { name: string; type: string; balanceCents: number }) => [a.name, a.type, a.balanceCents]))
      .toEqual([["Corrente", "checking", 150000], ["Cartão", "credit_card", -50000]]);
    // a compra no cartão continua sendo despesa do mês; o caixa só cai quando a fatura é paga
    expect(b.monthly[11]).toEqual({ month: "2026-06", incomeCents: 50000, expenseCents: 20000, transfersNetCents: 0, balanceCents: 150000 });
    expect(b.monthly[0].balanceCents).toBe(100000);
    for (const q of ["", "&entity=pf", "&entity=pj"]) {
      const r = (await get(u, `/dashboard/cashflow?${AS_OF}${q}`)).json();
      const cash = r.balances.accounts.filter((a: { type: string }) => a.type !== "credit_card");
      expect(r.monthly[11].balanceCents).toBe(sum(cash));
    }
    // a previsão parte do caixa (sem a dívida do cartão)
    expect(b.forecast[0].balanceCents).toBe(150000 - b.forecast[0].expenseCents + b.forecast[0].incomeCents);
  });

  it("accountId de um cartão: a série mostra o saldo do próprio cartão; o consolidado segue sendo do workspace", async () => {
    const { u, chk, card, tx } = await seedWithCard("cf-card2");
    await tx({ type: "income", accountId: chk.id, amountCents: 50000n });
    await tx({ type: "expense", accountId: card.id, amountCents: 20000n });
    const b = (await get(u, `/dashboard/cashflow?${AS_OF}&accountId=${card.id}`)).json();
    expect(b.balances.accounts.map((a: { name: string }) => a.name)).toEqual(["Cartão"]);
    expect(b.monthly[11].balanceCents).toBe(-50000);
    expect(b.monthly[0].balanceCents).toBe(-30000);
    expect(b.monthly[11].balanceCents).toBe(sum(b.balances.accounts));
    expect(b.balances.consolidated).toEqual({ pfCents: 150000, pjCents: 0, totalCents: 150000 });
    expect(b.balances.cards).toEqual({ pfCents: -50000, pjCents: 0, totalCents: -50000 });
    // conta corrente explícita: só ela
    const c = (await get(u, `/dashboard/cashflow?${AS_OF}&accountId=${chk.id}`)).json();
    expect(c.monthly[11].balanceCents).toBe(150000);
  });

  it("simples: corrente +100000 e cartão -30000 dão consolidado 100000 e cartões -30000", async () => {
    const { u } = await seedWithCard("cf-card3");
    const b = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    expect(b.balances.consolidated.totalCents).toBe(100000);
    expect(b.balances.cards.totalCents).toBe(-30000);
    expect(b.monthly[11].balanceCents).toBe(100000);
    const s = (await get(u, `/dashboard/summary?${AS_OF}`)).json();
    expect(s.balances).toEqual({ pfCents: 100000, pjCents: 0, totalCents: 100000, cards: { pfCents: -30000, pjCents: 0, totalCents: -30000 } });
  });

  it("conta de outro workspace e filtro inválido dão 400; sem lançamentos tudo vem zerado", async () => {
    const { u } = await seedCashflow("cf8");
    const other = await seedCashflow("cf8b");
    expect((await get(u, `/dashboard/cashflow?${AS_OF}&accountId=${other.pf1.id}`)).statusCode).toBe(400);
    expect((await get(u, "/dashboard/cashflow?entity=xx")).statusCode).toBe(400);
    const empty = await newUser("cf8c");
    const b = (await get(empty, `/dashboard/cashflow?${AS_OF}`)).json();
    expect(b.balances).toEqual({
      accounts: [],
      consolidated: { pfCents: 0, pjCents: 0, totalCents: 0 },
      cards: { pfCents: 0, pjCents: 0, totalCents: 0 },
    });
    expect(b.monthly).toHaveLength(12);
    expect(b.monthly.every((m: { balanceCents: number }) => m.balanceCents === 0)).toBe(true);
    expect(b.forecast).toHaveLength(3);
  });
});

describe("GET /dashboard/summary", () => {
  const AS_OF = "asOf=2026-06-20";

  async function seedSummary(tag: string) {
    const base = await seedCashflow(tag);
    const { u, tx } = base;
    const mk = (name: string, closingDay: number, dueDay: number) =>
      prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name, entity: "pf", closingDay, dueDay } });
    const cardA = await mk("Cartão A", 10, 17); // fecha 10/07, vence 17/07
    const cardB = await mk("Cartão B", 25, 5); // fecha 25/06, vence 05/07
    const cardC = await mk("Cartão C", 28, 2); // vence 02/07 mas sem compras no ciclo
    await tx({ type: "expense", accountId: cardA.id, amountCents: 10000n, date: dayOf("2026-06-12") });
    await tx({ type: "expense", accountId: cardA.id, amountCents: 20000n, date: dayOf("2026-06-15"), installmentCurrent: 2, installmentTotal: 10, description: "LOJA X 02/10" });
    await tx({ type: "income", accountId: cardA.id, amountCents: 3000n, date: dayOf("2026-06-18") });
    await tx({ type: "expense", accountId: cardB.id, amountCents: 8000n, date: dayOf("2026-06-15") });
    // fila de revisão: duas pendentes que contam; pareada e ignorada não contam
    await tx({ type: "expense", accountId: base.pf1.id, amountCents: 1500n, reviewStatus: "pending", description: "Pendente 1" });
    await tx({ type: "expense", accountId: base.pf1.id, amountCents: 1600n, reviewStatus: "pending", description: "Pendente 2" });
    await tx({ type: "expense", accountId: base.pf1.id, amountCents: 1700n, reviewStatus: "pending", transferPairId: "p9", description: "Pendente pareada" });
    await tx({ type: "expense", accountId: base.pf1.id, amountCents: 1800n, reviewStatus: "pending", ignored: true, description: "Pendente ignorada" });
    return { ...base, cardA, cardB, cardC };
  }

  it("saldos consolidados, pendentes, próxima fatura e bloco de gastos do mês de asOf", async () => {
    const { u, cardB } = await seedSummary("sm1");
    const res = await get(u, `/dashboard/summary?${AS_OF}`);
    expect(res.statusCode).toBe(200);
    const b = res.json();

    // PF (caixa): 220000 - 1500 - 1600 - 1700 - 1800 (as pendentes pesam no saldo); os cartões ficam fora do caixa
    const cashflow = (await get(u, `/dashboard/cashflow?${AS_OF}`)).json();
    // O resumo traz o saldo em contas (sem cartões) e, aninhado em `cards`, a dívida dos cartões (negativa = a pagar).
    expect(b.balances).toEqual({ ...cashflow.balances.consolidated, cards: cashflow.balances.cards });
    // caixa PF: 220000 - 6600 (pendentes) = 213400; cartões PF: -27000 (A) - 8000 (B) = -35000
    expect(b.balances).toEqual({
      pfCents: 213400, pjCents: 160000, totalCents: 373400,
      cards: { pfCents: -35000, pjCents: 0, totalCents: -35000 },
    });

    expect(b.pendingCount).toBe(2);
    expect(b.nextInvoice).toEqual({ accountId: cardB.id, name: "Cartão B", dueDate: "2026-07-05", openInvoiceCents: 8000, estimated: false });
    expect(b.cardsConfigured).toBe(true);

    const spending = (await get(u, "/dashboard/spending?month=2026-06&asOf=2026-06-20")).json();
    expect(b.spending.totalCents).toBe(spending.totalCents);
    // despesas de junho fora pares e ignorados: 50000 + 20000 + 10000 + 20000 + 8000 + 1500 + 1600 = 111100
    expect(b.spending.totalCents).toBe(111100);
    expect(b.spending.insight).toBe(spending.insight);
    expect(b.spending.byCategory).toEqual(spending.byCategory);
    expect(b.spending.byMonth.months).toHaveLength(12);
    expect(b.spending.byMonth.months[11]).toBe("2026-06");
    expect(b.spending.vsBudget).toEqual(spending.vsBudget);
  });

  it("accounts: todas as contas não arquivadas (caixa e cartões) com saldo, tipo, entidade, instituição e dias; ordem entidade/nome", async () => {
    const { u, pf1, pj1 } = await seedSummary("sm-acc");
    await prisma.bankAccount.update({ where: { id: pf1.id }, data: { institution: "inter" } });
    await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "savings", name: "Arquivada", entity: "pj", archived: true, openingBalanceCents: 99999n } });
    const b = (await get(u, `/dashboard/summary?${AS_OF}`)).json();

    type Acc = { accountId: string; name: string; type: string; entity: string; institution: string; balanceCents: number; closingDay: number | null; dueDay: number | null };
    const accounts: Acc[] = b.accounts;
    expect(accounts.map((a) => a.name)).toEqual(["Cartão A", "Cartão B", "Cartão C", "PF1", "PJ1"]);
    expect(accounts.map((a) => a.name)).not.toContain("Arquivada");
    const byName = Object.fromEntries(accounts.map((a) => [a.name, a]));
    expect(byName["PF1"]).toEqual({ accountId: pf1.id, name: "PF1", type: "checking", entity: "pf", institution: "inter", balanceCents: 213400, closingDay: null, dueDay: null });
    expect(byName["PJ1"]).toMatchObject({ accountId: pj1.id, type: "checking", entity: "pj", institution: "other", balanceCents: 160000 });
    // cartões guardam o próprio saldo negativo (dívida) e os dias configurados
    expect(byName["Cartão A"]).toMatchObject({ type: "credit_card", entity: "pf", balanceCents: -27000, closingDay: 10, dueDay: 17 });
    expect(byName["Cartão B"]).toMatchObject({ balanceCents: -8000, closingDay: 25, dueDay: 5 });
    expect(byName["Cartão C"]).toMatchObject({ balanceCents: 0, closingDay: 28, dueDay: 2 });

    // a soma das contas que não são cartão, por entidade, é o saldo consolidado; a dos cartões, a dívida
    const cash = (entity: string) => accounts.filter((a) => a.entity === entity && a.type !== "credit_card").reduce((s, a) => s + a.balanceCents, 0);
    const owed = (entity: string) => accounts.filter((a) => a.entity === entity && a.type === "credit_card").reduce((s, a) => s + a.balanceCents, 0);
    expect(cash("pf")).toBe(b.balances.pfCents);
    expect(cash("pj")).toBe(b.balances.pjCents);
    expect(owed("pf")).toBe(b.balances.cards.pfCents);
    expect(owed("pj")).toBe(b.balances.cards.pjCents);
  });

  it("accounts não mostra contas de outro workspace; sem contas vem vazio", async () => {
    const { u } = await seedSummary("sm-acc2");
    const other = await seedCashflow("sm-acc3");
    const ids = new Set((await prisma.bankAccount.findMany({ where: { workspaceId: other.u.workspaceId } })).map((a) => a.id));
    const mine = (await get(u, `/dashboard/summary?${AS_OF}`)).json().accounts as Array<{ accountId: string }>;
    expect(mine.length).toBe(5);
    expect(mine.some((a) => ids.has(a.accountId))).toBe(false);
    const empty = await newUser("sm-acc4");
    expect((await get(empty, `/dashboard/summary?${AS_OF}`)).json().accounts).toEqual([]);
  });

  it("month escolhe o mês dos gastos (totalCents/byCategory/insight); sem month vale o mês de asOf; saldos não mudam", async () => {
    const { u, pf1, tx } = await seedSummary("sm-month");
    const cat = await prisma.category.create({ data: { workspaceId: u.workspaceId, type: "expense", name: "Mercado M", entity: "both" } });
    await tx({ type: "expense", accountId: pf1.id, amountCents: 7000n, categoryId: cat.id, date: dayOf("2026-05-10") });

    const may = (await get(u, `/dashboard/summary?${AS_OF}&month=2026-05`)).json();
    expect(may.spending.totalCents).toBe(7000);
    expect(may.spending.month).toBe("2026-05");
    expect(may.spending.previousMonth).toBe("2026-04");
    expect(may.spending.byCategory).toEqual((await get(u, "/dashboard/spending?month=2026-05&asOf=2026-06-20")).json().byCategory.slice(0, 6));
    expect(may.spending.byCategory.map((c: { name: string }) => c.name)).toEqual(["Mercado M"]);
    expect(may.spending.byMonth.months[11]).toBe("2026-05");

    const def = (await get(u, `/dashboard/summary?${AS_OF}`)).json();
    expect(def.spending.totalCents).toBe(111100);
    expect(def.spending.month).toBe("2026-06");
    expect(def.spending.previousMonth).toBe("2026-05");
    const explicit = (await get(u, `/dashboard/summary?${AS_OF}&month=2026-06`)).json();
    expect(explicit.spending).toEqual(def.spending);

    // mês escolhido não mexe em saldos, pendências nem próxima fatura
    expect(may.balances).toEqual(def.balances);
    expect(may.pendingCount).toBe(def.pendingCount);
    expect(may.nextInvoice).toEqual(def.nextInvoice);
    // virada de ano: janeiro compara com dezembro
    const jan = (await get(u, `/dashboard/summary?${AS_OF}&month=2026-01`)).json();
    expect(jan.spending.previousMonth).toBe("2025-12");
  });

  it("month inválido dá 400", async () => {
    const { u } = await seedCashflow("sm-month2");
    expect((await get(u, `/dashboard/summary?${AS_OF}&month=2026-13`)).statusCode).toBe(400);
    expect((await get(u, `/dashboard/summary?${AS_OF}&month=junho`)).statusCode).toBe(400);
    expect((await get(u, `/dashboard/summary?${AS_OF}&month=2026-05&year=2026`)).statusCode).toBe(400);
    // vazio é ignorado
    expect((await get(u, `/dashboard/summary?${AS_OF}&month=`)).statusCode).toBe(200);
  });

  it("byCategory é cortado nas 6 maiores categorias", async () => {
    const { u, pf1, tx } = await seedSummary("sm2");
    for (let i = 1; i <= 8; i++) {
      const c = await prisma.category.create({ data: { workspaceId: u.workspaceId, type: "expense", name: `Cat ${i}`, entity: "both" } });
      await tx({ type: "expense", accountId: pf1.id, amountCents: BigInt(i * 1000), categoryId: c.id });
    }
    const full = (await get(u, "/dashboard/spending?month=2026-06&asOf=2026-06-20")).json();
    expect(full.byCategory.length).toBeGreaterThan(6);
    const b = (await get(u, `/dashboard/summary?${AS_OF}`)).json();
    expect(b.spending.byCategory).toHaveLength(6);
    expect(b.spending.byCategory).toEqual(full.byCategory.slice(0, 6));
    expect(b.spending.byCategory[0]).toMatchObject({ name: "Sem categoria" }); // as despesas do seed, sem categoria, são as maiores
    expect(b.spending.byCategory[1]).toMatchObject({ name: "Cat 8", totalCents: 8000 });
    expect(b.spending.byCategory.map((c: { name: string }) => c.name)).not.toContain("Cat 3");
  });

  it("sem cartão com fatura a vencer a próxima fatura é nula; sem lançamentos tudo vem zerado", async () => {
    const { u } = await seedCashflow("sm3");
    const b = (await get(u, `/dashboard/summary?${AS_OF}`)).json();
    expect(b.nextInvoice).toBeNull();
    expect(b.cardsConfigured).toBe(false);
    expect(b.pendingCount).toBe(0);
    expect(b.balances).toEqual({
      pfCents: 220000, pjCents: 160000, totalCents: 380000,
      cards: { pfCents: 0, pjCents: 0, totalCents: 0 },
    });
    expect(b.spending.byCategory.length).toBeLessThanOrEqual(6);

    const empty = await newUser("sm3b");
    const z = (await get(empty, `/dashboard/summary?${AS_OF}`)).json();
    expect(z).toMatchObject({ balances: { pfCents: 0, pjCents: 0, totalCents: 0, cards: { pfCents: 0, pjCents: 0, totalCents: 0 } }, pendingCount: 0, nextInvoice: null });
    expect(z.spending).toMatchObject({ totalCents: 0, byCategory: [] });
    expect((await get(empty, "/dashboard/summary?asOf=2026-13-40")).statusCode).toBe(400);
  });

  it("linha esquecida (sem categoria, fora da fila há 30 min) conta no resumo e aparece em /review/pending", async () => {
    const { u, pf1, tx } = await seedSummary("sm5");
    const forgotten = await tx({ type: "expense", accountId: pf1.id, amountCents: 2500n, description: "Esquecida" });
    await prisma.transaction.update({ where: { id: forgotten.id }, data: { createdAt: new Date(Date.now() - 30 * 60_000) } });
    const b = (await get(u, `/dashboard/summary?${AS_OF}`)).json();
    expect(b.pendingCount).toBe(3); // as 2 pendentes + a esquecida; as recém-criadas sem categoria ainda não contam
    const review = (await get(u, "/review/pending")).json();
    expect(review.total).toBe(3);
    expect(review.groups.flatMap((g: { transactionIds: string[] }) => g.transactionIds)).toContain(forgotten.id);
  });

  it("próxima fatura considera a fatura fechada ainda não paga", async () => {
    const u = await newUser("sm6");
    const card = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "credit_card", name: "Cartão", closingDay: 10, dueDay: 17 } });
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, accountId: card.id, source: "manual", createdById: u.userId, ...data } as never });
    await tx({ type: "expense", amountCents: 40000n, date: dayOf("2026-05-20") }); // fatura de 10/06, vence 17/06
    await tx({ type: "income", amountCents: 15000n, date: dayOf("2026-06-11"), transferPairId: "pp" }); // paga 15000 dela
    await tx({ type: "expense", amountCents: 5000n, date: dayOf("2026-06-11") }); // ciclo aberto: fecha 10/07, vence 17/07
    // asOf 12/06: a fatura fechada (restam 25000, vence 17/06) vem antes da aberta (5000, vence 17/07)
    const b = (await get(u, "/dashboard/summary?asOf=2026-06-12")).json();
    expect(b.nextInvoice).toEqual({ accountId: card.id, name: "Cartão", dueDate: "2026-06-17", openInvoiceCents: 25000, estimated: false });
    // depois do vencimento da fechada (asOf 18/06) só resta a aberta
    const depois = (await get(u, "/dashboard/summary?asOf=2026-06-18")).json();
    expect(depois.nextInvoice).toEqual({ accountId: card.id, name: "Cartão", dueDate: "2026-07-17", openInvoiceCents: 5000, estimated: false });
  });

  it("cartão configurado com saldo devedor e sem lançamentos: próxima fatura estimada pelo saldo do cartão", async () => {
    const u = await newUser("sm7");
    const card = await prisma.bankAccount.create({
      data: { workspaceId: u.workspaceId, type: "credit_card", name: "Cartão", closingDay: 9, dueDay: 15, openingBalanceCents: -45269n },
    });
    const b = (await get(u, "/dashboard/summary?asOf=2026-10-01")).json();
    expect(b.nextInvoice).toEqual({ accountId: card.id, name: "Cartão", dueDate: "2026-10-15", openInvoiceCents: 45269, estimated: true });
    expect(b.cardsConfigured).toBe(true);
  });

  it("fallback do saldo devedor não duplica cartão que já tem fatura calculada", async () => {
    const u = await newUser("sm8");
    const comFatura = await prisma.bankAccount.create({
      data: { workspaceId: u.workspaceId, type: "credit_card", name: "Com fatura", closingDay: 9, dueDay: 15 },
    });
    await prisma.bankAccount.create({
      data: { workspaceId: u.workspaceId, type: "credit_card", name: "Só saldo", closingDay: 9, dueDay: 20, openingBalanceCents: -10000n },
    });
    await prisma.transaction.create({
      data: { workspaceId: u.workspaceId, accountId: comFatura.id, source: "manual", createdById: u.userId, type: "expense", amountCents: 30000n, date: dayOf("2026-09-20") } as never,
    });
    // asOf 01/10: o ciclo aberto de "Com fatura" (fecha 09/10, vence 15/10) tem fatura calculada; "Só saldo" (vence 20/10) só tem saldo devedor
    const b = (await get(u, "/dashboard/summary?asOf=2026-10-01")).json();
    expect(b.nextInvoice).toEqual({ accountId: comFatura.id, name: "Com fatura", dueDate: "2026-10-15", openInvoiceCents: 30000, estimated: false });
    // só o cartão com saldo, sem a fatura calculada do outro: aparece como estimada
    await prisma.transaction.deleteMany({ where: { accountId: comFatura.id } });
    const c = (await get(u, "/dashboard/summary?asOf=2026-10-01")).json();
    expect(c.nextInvoice).toMatchObject({ name: "Só saldo", dueDate: "2026-10-20", openInvoiceCents: 10000, estimated: true });
  });

  it("cartão sem dias configurados não gera fatura e cardsConfigured é falso", async () => {
    const u = await newUser("sm9");
    await prisma.bankAccount.create({
      data: { workspaceId: u.workspaceId, type: "credit_card", name: "Sem dia", openingBalanceCents: -5000n },
    });
    const b = (await get(u, "/dashboard/summary?asOf=2026-10-01")).json();
    expect(b.nextInvoice).toBeNull();
    expect(b.cardsConfigured).toBe(false);
  });

  it("cartão configurado sem dívida e sem faturas: próxima fatura nula, cardsConfigured verdadeiro", async () => {
    const u = await newUser("sm10");
    await prisma.bankAccount.create({
      data: { workspaceId: u.workspaceId, type: "credit_card", name: "Zerado", closingDay: 9, dueDay: 15 },
    });
    const b = (await get(u, "/dashboard/summary?asOf=2026-10-01")).json();
    expect(b.nextInvoice).toBeNull();
    expect(b.cardsConfigured).toBe(true);
  });

  it("não vaza dados de outro workspace", async () => {
    const a = await seedSummary("sm4");
    const other = await newUser("sm4b");
    const z = (await get(other, `/dashboard/summary?${AS_OF}`)).json();
    expect(z.balances.totalCents).toBe(0);
    expect(z.pendingCount).toBe(0);
    expect(z.nextInvoice).toBeNull();
    expect((await get(a.u, `/dashboard/summary?${AS_OF}`)).json().pendingCount).toBe(2);
  });
});
