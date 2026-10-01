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
const account = (u: User, type: "checking" | "credit_card" = "checking", data: { name?: string; openingBalanceCents?: bigint; archived?: boolean } = {}) =>
  prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type, name: data.name ?? type, openingBalanceCents: data.openingBalanceCents, archived: data.archived } });
const tx = (u: User, data: { type: "income" | "expense" | "transfer"; amountCents: bigint; accountId?: string; sourceAccountId?: string; destAccountId?: string; transferPairId?: string; ignored?: boolean; date?: string }) =>
  prisma.transaction.create({
    data: {
      workspaceId: u.workspaceId, createdById: u.userId, date: new Date(`${data.date ?? "2026-06-10"}T00:00:00Z`),
      type: data.type, amountCents: data.amountCents, accountId: data.accountId, sourceAccountId: data.sourceAccountId,
      destAccountId: data.destAccountId, transferPairId: data.transferPairId, ignored: data.ignored,
    },
  });
const balanceOf = async (u: User, accountId: string) => {
  const res = await get(u, "/balances");
  expect(res.statusCode).toBe(200);
  return (res.json() as { accounts: Array<{ accountId: string; balanceCents: number }> }).accounts.find((a) => a.accountId === accountId)?.balanceCents;
};
const openingOf = async (accountId: string) => Number((await prisma.bankAccount.findUniqueOrThrow({ where: { id: accountId } })).openingBalanceCents);

describe("POST /accounts/:id/reconcile", () => {
  it("ajusta o saldo inicial para o saldo real e a segunda chamada igual não ajusta nada", async () => {
    const u = await newUser("conc1");
    const acc = await account(u);
    await tx(u, { type: "income", amountCents: 10000n, accountId: acc.id });
    await tx(u, { type: "expense", amountCents: 2000n, accountId: acc.id });
    expect(await balanceOf(u, acc.id)).toBe(8000);

    const res = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 1659 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accountId: acc.id, previousBalanceCents: 8000, newBalanceCents: 1659, adjustmentCents: -6341, openingBalanceCents: -6341,
    });
    expect(await openingOf(acc.id)).toBe(-6341);
    expect(await balanceOf(u, acc.id)).toBe(1659);

    const again = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 1659 });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({
      accountId: acc.id, previousBalanceCents: 1659, newBalanceCents: 1659, adjustmentCents: 0, openingBalanceCents: -6341,
    });
    expect(await openingOf(acc.id)).toBe(-6341);
  });

  it("soma o ajuste ao saldo inicial que já existia (positivo)", async () => {
    const u = await newUser("conc2");
    const acc = await account(u, "checking", { openingBalanceCents: 5000n });
    await tx(u, { type: "expense", amountCents: 1000n, accountId: acc.id });
    const res = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 10000 });
    expect(res.json()).toMatchObject({ previousBalanceCents: 4000, adjustmentCents: 6000, openingBalanceCents: 11000, newBalanceCents: 10000 });
    expect(await balanceOf(u, acc.id)).toBe(10000);
  });

  it("aceita saldo alvo negativo e zero", async () => {
    const u = await newUser("conc3");
    const acc = await account(u);
    await tx(u, { type: "income", amountCents: 500n, accountId: acc.id });
    const neg = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: -12050 });
    expect(neg.statusCode).toBe(200);
    expect(neg.json()).toMatchObject({ previousBalanceCents: 500, newBalanceCents: -12050, adjustmentCents: -12550, openingBalanceCents: -12550 });
    expect(await balanceOf(u, acc.id)).toBe(-12050);
    const zero = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 0 });
    expect(zero.json()).toMatchObject({ newBalanceCents: 0, adjustmentCents: 12050 });
    expect(await balanceOf(u, acc.id)).toBe(0);
  });

  it("conta de outro workspace e conta inexistente dão 404 e não alteram nada", async () => {
    const a = await newUser("conc4a");
    const b = await newUser("conc4b");
    const accB = await account(b, "checking", { openingBalanceCents: 700n });
    const res = await post(a, `/accounts/${accB.id}/reconcile`, { balanceCents: 1 });
    expect(res.statusCode).toBe(404);
    expect(await openingOf(accB.id)).toBe(700);
    expect((await post(a, "/accounts/nao-existe/reconcile", { balanceCents: 1 })).statusCode).toBe(404);
  });

  it("conta arquivada dá 404", async () => {
    const u = await newUser("conc5");
    const acc = await account(u, "checking", { archived: true, openingBalanceCents: 100n });
    const res = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 5000 });
    expect(res.statusCode).toBe(404);
    expect(await openingOf(acc.id)).toBe(100);
  });

  it("corpo inválido (texto, decimal, ausente, nulo) dá 400 e não altera o saldo inicial", async () => {
    const u = await newUser("conc6");
    const acc = await account(u, "checking", { openingBalanceCents: 100n });
    for (const body of [{ balanceCents: "1659" }, { balanceCents: 1.5 }, {}, { balanceCents: null }, { balanceCents: 1e300 }]) {
      const res = await post(u, `/accounts/${acc.id}/reconcile`, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await openingOf(acc.id)).toBe(100);
  });

  it("recusa com 400 quando o novo saldo inicial estouraria a faixa de inteiros seguros", async () => {
    const u = await newUser("conc7");
    const acc = await account(u);
    await tx(u, { type: "income", amountCents: 9007199254740000n, accountId: acc.id });
    const res = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: -9007199254740000 });
    expect(res.statusCode).toBe(400);
    expect(await openingOf(acc.id)).toBe(0);
  });

  it("pares e ignorados contam no saldo (semântica do banco) e entram no ajuste; transferências também", async () => {
    const u = await newUser("conc8");
    const acc = await account(u);
    const other = await account(u, "checking", { name: "outra" });
    await tx(u, { type: "income", amountCents: 10000n, accountId: acc.id });
    await tx(u, { type: "expense", amountCents: 3000n, accountId: acc.id, transferPairId: "par1" });
    await tx(u, { type: "income", amountCents: 500n, accountId: acc.id, ignored: true });
    await tx(u, { type: "transfer", amountCents: 1000n, sourceAccountId: other.id, destAccountId: acc.id });
    await tx(u, { type: "transfer", amountCents: 200n, sourceAccountId: acc.id, destAccountId: other.id });
    // 10000 - 3000 + 500 + 1000 - 200 = 8300
    expect(await balanceOf(u, acc.id)).toBe(8300);
    const res = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 8000 });
    expect(res.json()).toMatchObject({ previousBalanceCents: 8300, adjustmentCents: -300, openingBalanceCents: -300 });
    expect(await balanceOf(u, acc.id)).toBe(8000);
    expect(await balanceOf(u, other.id)).toBe(-800); // a outra conta não é afetada
  });

  it("funciona em conta de cartão de crédito (saldo negativo = valor devido)", async () => {
    const u = await newUser("conc9");
    const card = await account(u, "credit_card");
    await tx(u, { type: "expense", amountCents: 25000n, accountId: card.id });
    expect(await balanceOf(u, card.id)).toBe(-25000);
    const res = await post(u, `/accounts/${card.id}/reconcile`, { balanceCents: -31050 });
    expect(res.json()).toMatchObject({ previousBalanceCents: -25000, adjustmentCents: -6050, openingBalanceCents: -6050 });
    expect(await balanceOf(u, card.id)).toBe(-31050);
  });

  it("exige autenticação", async () => {
    const res = await app.inject({ method: "POST", url: "/accounts/x/reconcile", payload: { balanceCents: 1 } });
    expect([401, 403]).toContain(res.statusCode);
  });
});
