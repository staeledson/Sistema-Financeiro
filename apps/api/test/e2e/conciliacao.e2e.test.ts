import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { AccountsService } from "../../src/accounts/accounts.service";
import { c6SampleText } from "../../../../packages/shared/src/parsers/__fixtures__/c6-sample";

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

describe("reconcile: falhas de concorrência e faixa", () => {
  it("saldo atual fora da faixa segura dá 422 e não altera nada", async () => {
    const u = await newUser("conc10");
    const acc = await account(u);
    await tx(u, { type: "income", amountCents: 9007199254740000n, accountId: acc.id });
    await tx(u, { type: "income", amountCents: 9007199254740000n, accountId: acc.id });
    const res = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 100 });
    expect(res.statusCode).toBe(422);
    expect(await openingOf(acc.id)).toBe(0);
  });

  it("conta travada por outra operação: depois do lock timeout responde 409 em pt-BR e não altera nada", async () => {
    const u = await newUser("conc11");
    const acc = await account(u, "checking", { openingBalanceCents: 100n });
    const svc = app.get(AccountsService);
    const original = svc.lockTimeoutMs;
    svc.lockTimeoutMs = 300;
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => { locked = r; });
    const holder = prisma.$transaction(async (t) => {
      await t.$queryRaw`SELECT "id" FROM bank_accounts WHERE "id" = ${acc.id} FOR UPDATE`;
      locked();
      await held;
    }, { timeout: 20_000 });
    try {
      await isLocked;
      const res = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 5000 });
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Outra operação está em andamento nesta conta; tente novamente.");
    } finally {
      svc.lockTimeoutMs = original;
      release();
      await holder;
    }
    expect(await openingOf(acc.id)).toBe(100);
    // liberada a trava, a conciliação funciona
    expect((await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 5000 })).statusCode).toBe(200);
  });
});

const ofx = (rows: Array<[id: string, date: string, amount: string]>) => `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>077<ACCTID>555-1</BANKACCTFROM>
<BANKTRANLIST>
${rows.map(([id, date, amt]) => `<STMTTRN><TRNTYPE>${amt.startsWith("-") ? "DEBIT" : "CREDIT"}<DTPOSTED>${date}<TRNAMT>${amt}<FITID>${id}<MEMO>Mov ${id}</STMTTRN>`).join("\n")}
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

async function importText(u: User, accountId: string, text: string, format: "ofx" | "pdf_statement") {
  const pv = await post(u, "/import/preview", { accountId, text, format });
  expect(pv.statusCode).toBe(200);
  const body = pv.json();
  const commit = await post(u, `/import/${body.batchId}/commit`, {
    rows: body.rows.map((r: Record<string, unknown>) => ({
      type: r.type, amountCents: r.amountCents, date: r.date, postedDate: r.postedDate, description: r.description, fingerprint: r.fingerprint, accountId,
    })),
  });
  expect(commit.statusCode).toBe(200);
  return { preview: body, commit: commit.json() as { inserted: number; skipped: number } };
}

describe("reconcile + importação", () => {
  it("conciliar e depois reimportar extrato que se sobrepõe: saldo = alvo + só as linhas novas (duplicatas puladas)", async () => {
    const u = await newUser("conc12");
    const acc = await account(u);
    const first = await importText(u, acc.id, ofx([["F1", "20260605", "-35.00"], ["F2", "20260610", "100.00"]]), "ofx");
    expect(first.commit).toEqual({ inserted: 2, skipped: 0 });
    expect(await balanceOf(u, acc.id)).toBe(6500);

    await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 1659 });
    expect(await balanceOf(u, acc.id)).toBe(1659);

    const second = await importText(u, acc.id, ofx([["F2", "20260610", "100.00"], ["F3", "20260612", "5.00"]]), "ofx");
    expect(second.commit).toEqual({ inserted: 1, skipped: 1 });
    expect(await balanceOf(u, acc.id)).toBe(1659 + 500);
  });

  it("conciliar e depois desfazer a importação: o ajuste do saldo inicial NÃO é revertido (comportamento documentado)", async () => {
    const u = await newUser("conc13");
    const acc = await account(u);
    const { preview } = await importText(u, acc.id, ofx([["F1", "20260605", "-35.00"], ["F2", "20260610", "100.00"]]), "ofx");
    await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 1659 }); // saldo inicial passa a -4841
    expect((await post(u, `/import/${preview.batchId}/undo`, {})).statusCode).toBe(200);
    // as linhas (+65,00 líquidos) saem, o saldo inicial ajustado fica: o saldo deriva para alvo - 65,00 e exige nova conciliação
    expect(await openingOf(acc.id)).toBe(-4841);
    expect(await balanceOf(u, acc.id)).toBe(1659 - 6500);
    const again = await post(u, `/accounts/${acc.id}/reconcile`, { balanceCents: 1659 });
    expect(again.json()).toMatchObject({ previousBalanceCents: -4841, adjustmentCents: 6500, openingBalanceCents: 1659 });
  });
});

describe("preview: laterActivity (lançamentos depois da data do saldo do extrato)", () => {
  const preview = async (u: User, accountId: string, text = c6SampleText()) => {
    const res = await post(u, "/import/preview", { accountId, text, format: "pdf_statement" });
    expect(res.statusCode).toBe(200);
    return res.json() as { statementBalance: { dateISO: string } | null; laterActivity: boolean };
  };

  it("false sem lançamentos; true com lançamento da conta depois da data; false se for anterior", async () => {
    const u = await newUser("later1");
    const acc = await account(u);
    expect(await preview(u, acc.id)).toMatchObject({ statementBalance: { dateISO: "2025-11-05" }, laterActivity: false });
    await tx(u, { type: "expense", amountCents: 100n, accountId: acc.id, date: "2025-11-01" });
    expect((await preview(u, acc.id)).laterActivity).toBe(false);
    await tx(u, { type: "expense", amountCents: 100n, accountId: acc.id, date: "2025-12-01" });
    expect((await preview(u, acc.id)).laterActivity).toBe(true);
  });

  it("transferência da conta (origem ou destino) depois da data também conta; de outra conta não", async () => {
    const u = await newUser("later2");
    const acc = await account(u);
    const other = await account(u, "checking", { name: "outra" });
    const third = await account(u, "checking", { name: "terceira" });
    await tx(u, { type: "transfer", amountCents: 100n, sourceAccountId: other.id, destAccountId: third.id, date: "2025-12-01" });
    expect((await preview(u, acc.id)).laterActivity).toBe(false);
    await tx(u, { type: "transfer", amountCents: 100n, sourceAccountId: other.id, destAccountId: acc.id, date: "2025-12-02" });
    expect((await preview(u, acc.id)).laterActivity).toBe(true);
  });

  it("linhas do próprio extrato (mesma impressão digital) não contam, mesmo datadas depois do saldo", async () => {
    const u = await newUser("later3");
    const acc = await account(u);
    // saldo corrente "em 1/11" com linhas do extrato datadas depois dele
    const text = c6SampleText().replace("Saldo do dia • 5 de novembro de 2025", "Saldo do dia • 1 de novembro de 2025");
    expect((await preview(u, acc.id, text)).laterActivity).toBe(false);
    await importText(u, acc.id, text, "pdf_statement");
    const again = await preview(u, acc.id, text);
    expect(again.statementBalance).toMatchObject({ dateISO: "2025-11-01" });
    expect(again.laterActivity).toBe(false);
    // mas um lançamento manual depois da data conta
    await tx(u, { type: "expense", amountCents: 100n, accountId: acc.id, date: "2025-12-01" });
    expect((await preview(u, acc.id, text)).laterActivity).toBe(true);
  });

  it("sem saldo corrente no extrato (OFX): statementBalance null e laterActivity false", async () => {
    const u = await newUser("later4");
    const acc = await account(u);
    await tx(u, { type: "expense", amountCents: 100n, accountId: acc.id, date: "2030-01-01" });
    const res = await post(u, "/import/preview", { accountId: acc.id, text: ofx([["F1", "20260605", "-35.00"]]), format: "ofx" });
    expect(res.json()).toMatchObject({ statementBalance: null, laterActivity: false });
  });
});
