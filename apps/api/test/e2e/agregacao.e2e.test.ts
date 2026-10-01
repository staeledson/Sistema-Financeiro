import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { TOOLS } from "../../src/chat/tools";

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

const MONTH = new Date().toISOString().slice(0, 7);
const DAY = new Date(`${MONTH}-10T00:00:00Z`);

async function seed(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  const acc = await prisma.bankAccount.create({ data: { workspaceId: ws.id, type: "checking", name: "Conta", openingBalanceCents: 0n } });
  const acc2 = await prisma.bankAccount.create({ data: { workspaceId: ws.id, type: "checking", name: "Conta 2", openingBalanceCents: 0n } });
  const cat = await prisma.category.create({ data: { workspaceId: ws.id, type: "expense", name: "Mercado agr" } });
  const make = (data: Record<string, unknown>) =>
    prisma.transaction.create({
      data: { workspaceId: ws.id, accountId: acc.id, date: DAY, source: "manual", createdById: u!.user.id, ...data } as never,
    });

  await make({ type: "expense", amountCents: 1000n, categoryId: cat.id });                       // conta
  await make({ type: "income", amountCents: 2000n });                                            // conta
  await make({ type: "expense", amountCents: 500n, categoryId: cat.id, transferPairId: "p1" });  // par: fora
  await make({ type: "income", amountCents: 700n, transferPairId: "p1" });                       // par: fora
  await make({ type: "expense", amountCents: 300n, categoryId: cat.id, ignored: true });         // ignorado: fora
  // transferência entre duas contas do usuário: não é receita nem despesa e não altera o saldo consolidado
  await make({ type: "transfer", amountCents: 400n, accountId: null, sourceAccountId: acc.id, destAccountId: acc2.id });
  return { ws, u: u!, acc, acc2, cat, h: { authorization: `Bearer ${u!.token}` } };
}

describe("receita e despesa ignoram pareados, ignorados e transferências", () => {
  it("dashboard: fluxo do mês, quebra por categoria e série", async () => {
    const { h } = await seed("agr1");
    const res = await app.inject({ method: "GET", url: `/dashboard?month=${MONTH}`, headers: h });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cashflow).toEqual({ incomeCents: 2000, expenseCents: 1000 });
    expect(body.expenseBreakdown).toEqual([expect.objectContaining({ totalCents: 1000 })]);
    const current = body.cashflowSeries.find((s: { month: string }) => s.month === MONTH);
    expect(current).toMatchObject({ incomeCents: 2000, expenseCents: 1000 });
  });

  it("chat: get_cashflow, get_category_spending e get_cashflow_series", async () => {
    const { ws } = await seed("agr2");
    const ctx = { workspaceId: ws.id };
    expect(await TOOLS.get_cashflow.run({ month: MONTH }, ctx)).toMatchObject({ incomeCents: 2000, expenseCents: 1000 });
    const spending = (await TOOLS.get_category_spending.run({ month: MONTH, type: "expense" }, ctx)) as Array<{ totalCents: number }>;
    expect(spending.map((s) => s.totalCents)).toEqual([1000]);
    const series = (await TOOLS.get_cashflow_series.run({ months: 1 }, ctx)) as Array<{ incomeCents: number; expenseCents: number }>;
    expect(series[0]).toMatchObject({ incomeCents: 2000, expenseCents: 1000 });
  });

  it("orçamentos: o progresso não conta pareados nem ignorados", async () => {
    const { h, cat } = await seed("agr3");
    const created = await app.inject({
      method: "POST", url: "/budgets", headers: { ...h, "content-type": "application/json" },
      payload: { categoryId: cat.id, method: "fixed", limitCents: 10000 },
    });
    expect([200, 201]).toContain(created.statusCode);
    const status = await app.inject({ method: "GET", url: "/budgets/status", headers: h });
    const b = (status.json() as Array<{ categoryId: string | null; spentCents: number }>).find((x) => x.categoryId === cat.id);
    expect(b?.spentCents).toBe(1000);
  });

  it("o saldo por conta continua contando todos os movimentos", async () => {
    const { h } = await seed("agr4");
    const res = await app.inject({ method: "GET", url: "/balances", headers: h });
    // 2000 + 700 (receitas) − 1000 − 500 − 300 (despesas) = 900; a transferência de 400 entre as duas contas soma zero no consolidado
    expect(res.json().consolidatedCents).toBe(900);
  });
});
