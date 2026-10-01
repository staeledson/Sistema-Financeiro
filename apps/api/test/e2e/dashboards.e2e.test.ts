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

  it("parâmetros vazios são ignorados", async () => {
    const u = await newUser("sp6");
    const res = await get(u, "/dashboard/spending?month=2026-06&entity=&accountId=");
    expect(res.statusCode).toBe(200);
    expect(res.json().totalCents).toBe(0);
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
    await tx({ type: "transfer", sourceAccountId: pf1.id, destAccountId: pj1.id, amountCents: 400n, date: dayOf("2026-07-01") });
    return { u, pf1, pj1 };
  }

  it("mantém o contrato e inclui pares e ignorados no saldo", async () => {
    const { u, pf1, pj1 } = await seedBalances("bal1");
    const body = (await get(u, "/balances")).json();
    expect(body.accounts).toEqual([
      { accountId: pf1.id, name: "PF1", type: "checking", balanceCents: 219600 },
      { accountId: pj1.id, name: "PJ1", type: "checking", balanceCents: 80400 },
    ]);
    expect(body.consolidatedCents).toBe(300000);
  });

  it("entity, accountId e asOf restringem o resultado", async () => {
    const { u, pf1 } = await seedBalances("bal2");
    const pf = (await get(u, "/balances?entity=pf")).json();
    expect(pf.accounts.map((a: { name: string }) => a.name)).toEqual(["PF1"]);
    expect(pf.consolidatedCents).toBe(219600);
    const pj = (await get(u, "/balances?entity=pj")).json();
    expect(pj.consolidatedCents).toBe(80400);
    const one = (await get(u, `/balances?accountId=${pf1.id}`)).json();
    expect(one.consolidatedCents).toBe(219600);
    // a transferência de 400 é de julho: antes dela PF1 = 100000 + 200000 - 50000 - 30000 = 220000
    const antes = (await get(u, "/balances?entity=pf&asOf=2026-06-30")).json();
    expect(antes.consolidatedCents).toBe(220000);
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

    expect(c.installmentsAhead).toHaveLength(12);
    expect(c.installmentsAhead[0]).toEqual({ month: "2026-08", amountCents: 20000, count: 1 });
    expect(c.installmentsAhead.slice(0, 8).every((e: { amountCents: number; count: number }) => e.amountCents === 20000 && e.count === 1)).toBe(true);
    expect(c.installmentsAhead[7].month).toBe("2027-03");
    expect(c.installmentsAhead.slice(8)).toEqual([
      { month: "2027-04", amountCents: 0, count: 0 }, { month: "2027-05", amountCents: 0, count: 0 },
      { month: "2027-06", amountCents: 0, count: 0 }, { month: "2027-07", amountCents: 0, count: 0 },
    ]);

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
});
