import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BalancesService } from "../../src/balances/balances.service";

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
  const h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };
  const mp = await prisma.bankAccount.create({
    data: { workspaceId: ws!.id, type: "checking", name: "MP PF", entity: "pf", institution: "mercado_pago" },
  });
  const batch = await prisma.importBatch.create({
    data: { workspaceId: ws!.id, accountId: mp.id, format: "pdf_statement", status: "preview", createdById: u!.user.id },
  });
  return { ws: ws!, h, mp, batch };
}

const row = (accountId: string, n: number, type: "income" | "expense", amountCents: number, description: string) => ({
  type, amountCents, date: "2026-09-10", accountId, description, fingerprint: `fp-${n}`,
});

const commit = (ctx: Awaited<ReturnType<typeof setup>>, rows: unknown[]) =>
  app.inject({ method: "POST", url: `/import/${ctx.batch.id}/commit`, headers: ctx.h, payload: { rows } });

describe("Reserva como conta: movimentos viram transferência na importação", () => {
  it("guardar e retirar viram transfer entre a conta e a reserva; o resto segue como estava", async () => {
    const ctx = await setup("rsv1");
    const reserva = await prisma.bankAccount.create({
      data: { workspaceId: ctx.ws.id, type: "savings", name: "Reserva Emergência", entity: "pf", institution: "mercado_pago" },
    });

    const res = await commit(ctx, [
      row(ctx.mp.id, 1, "expense", 350, "Reserva por gastos Reserva Emergência"),
      row(ctx.mp.id, 2, "income", 1000, "Dinheiro retirado Reserva Emergência"),
      row(ctx.mp.id, 3, "expense", 4200, "Pix enviado para ALINE LOPES MELO"),
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json().inserted).toBe(3);

    const txs = await prisma.transaction.findMany({ where: { workspaceId: ctx.ws.id }, orderBy: { importFingerprint: "asc" } });
    const [guardar, retirar, pix] = txs;

    expect(guardar).toMatchObject({ type: "transfer", sourceAccountId: ctx.mp.id, destAccountId: reserva.id, accountId: ctx.mp.id, categoryId: null, reviewStatus: "ok" });
    expect(retirar).toMatchObject({ type: "transfer", sourceAccountId: reserva.id, destAccountId: ctx.mp.id, accountId: ctx.mp.id, categoryId: null, reviewStatus: "ok" });
    expect(pix).toMatchObject({ type: "expense", sourceAccountId: null, destAccountId: null });
    expect(Number(guardar.amountCents)).toBe(350);

    // o saldo da conta não muda (continua refletindo o extrato) e a reserva recebe o líquido
    const balances = await new BalancesService().accountBalances(ctx.ws.id);
    const byId = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
    expect(byId.get(ctx.mp.id)).toBe(-350 + 1000 - 4200);
    expect(byId.get(reserva.id)).toBe(350 - 1000);
  });

  it("reimportar o mesmo extrato não duplica", async () => {
    const ctx = await setup("rsv2");
    await prisma.bankAccount.create({
      data: { workspaceId: ctx.ws.id, type: "savings", name: "Reserva", entity: "pf", institution: "mercado_pago" },
    });
    const rows = [row(ctx.mp.id, 1, "expense", 350, "Reserva programada Reserva Emergência")];
    expect((await commit(ctx, rows)).json().inserted).toBe(1);
    expect((await commit(ctx, rows)).json().inserted).toBe(0);
    expect(await prisma.transaction.count({ where: { workspaceId: ctx.ws.id } })).toBe(1);
  });

  it("sem conta de reserva, o movimento continua despesa/receita", async () => {
    const ctx = await setup("rsv3");
    await commit(ctx, [row(ctx.mp.id, 1, "expense", 350, "Reserva por gastos Reserva Emergência")]);
    const tx = await prisma.transaction.findFirstOrThrow({ where: { workspaceId: ctx.ws.id } });
    expect(tx.type).toBe("expense");
  });

  it("duas reservas candidatas (ambíguo), de outra instituição ou de outra entidade, não são usadas", async () => {
    const ambig = await setup("rsv4");
    for (const name of ["Reserva A", "Reserva B"]) {
      await prisma.bankAccount.create({ data: { workspaceId: ambig.ws.id, type: "savings", name, entity: "pf", institution: "mercado_pago" } });
    }
    await commit(ambig, [row(ambig.mp.id, 1, "expense", 350, "Reserva por gastos Reserva Emergência")]);
    expect((await prisma.transaction.findFirstOrThrow({ where: { workspaceId: ambig.ws.id } })).type).toBe("expense");

    const other = await setup("rsv5");
    await prisma.bankAccount.create({ data: { workspaceId: other.ws.id, type: "savings", name: "Poupança BB", entity: "pf", institution: "bb" } });
    await prisma.bankAccount.create({ data: { workspaceId: other.ws.id, type: "savings", name: "Reserva PJ", entity: "pj", institution: "mercado_pago" } });
    await commit(other, [row(other.mp.id, 1, "expense", 350, "Reserva por gastos Reserva Emergência")]);
    expect((await prisma.transaction.findFirstOrThrow({ where: { workspaceId: other.ws.id } })).type).toBe("expense");
  });

  it("conta que não é do Mercado Pago não usa poupança de outro banco como reserva", async () => {
    const ctx = await setup("rsv7");
    await prisma.bankAccount.update({ where: { id: ctx.mp.id }, data: { institution: "other" } });
    await prisma.bankAccount.create({ data: { workspaceId: ctx.ws.id, type: "savings", name: "Poupança Itaú", entity: "pf", institution: "other" } });
    await commit(ctx, [row(ctx.mp.id, 1, "expense", 350, "Reserva por gastos Reserva Emergência")]);
    expect((await prisma.transaction.findFirstOrThrow({ where: { workspaceId: ctx.ws.id } })).type).toBe("expense");
  });

  it("transferência de reserva não entra nas despesas do painel", async () => {
    const ctx = await setup("rsv6");
    await prisma.bankAccount.create({
      data: { workspaceId: ctx.ws.id, type: "savings", name: "Reserva", entity: "pf", institution: "mercado_pago" },
    });
    await commit(ctx, [
      row(ctx.mp.id, 1, "expense", 350, "Reserva por gastos Reserva Emergência"),
      row(ctx.mp.id, 2, "expense", 1000, "Pix enviado para ASSAI"),
    ]);
    const res = await app.inject({ method: "GET", url: "/dashboard/summary?month=2026-09&asOf=2026-09-30", headers: ctx.h });
    expect(res.statusCode).toBe(200);
    expect(res.json().spending.totalCents).toBe(1000);
  });
});

describe("script de backfill da Reserva (produção)", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../scripts/backfill-reserva-mercado-pago.sql"), "utf8");
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
  const runScript = async () => {
    for (const st of statements) await prisma.$executeRawUnsafe(st);
  };

  it("cria a conta Reserva e converte o histórico sem mudar o saldo da conta; rodar de novo não muda nada", async () => {
    const ctx = await setup("bkf1");
    const mk = (n: number, type: "income" | "expense", amountCents: number, description: string) =>
      prisma.transaction.create({
        data: {
          workspaceId: ctx.ws.id, type, amountCents, date: new Date("2026-09-10"), accountId: ctx.mp.id, description,
          source: "import", importFingerprint: `bk-${n}`, createdById: ctx.ws.createdById, reviewStatus: "pending",
        },
      });
    await mk(1, "expense", 350, "Reserva por gastos Reserva Emergência");
    await mk(2, "expense", 1000, "Reserva programada Reserva Emergência");
    await mk(3, "income", 700, "Dinheiro retirado Reserva Emergência");
    await mk(4, "expense", 4200, "Pix enviado para ALINE LOPES MELO");
    const before = await new BalancesService().accountBalances(ctx.ws.id);
    expect(before.find((b) => b.accountId === ctx.mp.id)!.balanceCents).toBe(-350 - 1000 + 700 - 4200);

    await runScript();
    await runScript();

    const reservas = await prisma.bankAccount.findMany({ where: { workspaceId: ctx.ws.id, type: "savings" } });
    expect(reservas).toHaveLength(1);
    expect(reservas[0]).toMatchObject({ name: "Reserva Emergência", entity: "pf", institution: "mercado_pago", archived: false });

    const txs = await prisma.transaction.findMany({ where: { workspaceId: ctx.ws.id }, orderBy: { importFingerprint: "asc" } });
    expect(txs.map((t) => t.type)).toEqual(["transfer", "transfer", "transfer", "expense"]);
    expect(txs[0]).toMatchObject({ sourceAccountId: ctx.mp.id, destAccountId: reservas[0].id, reviewStatus: "ok", categoryId: null });
    expect(txs[2]).toMatchObject({ sourceAccountId: reservas[0].id, destAccountId: ctx.mp.id });

    const after = await new BalancesService().accountBalances(ctx.ws.id);
    expect(after.find((b) => b.accountId === ctx.mp.id)!.balanceCents).toBe(-350 - 1000 + 700 - 4200);
    expect(after.find((b) => b.accountId === reservas[0].id)!.balanceCents).toBe(350 + 1000 - 700);
  });

  it("não cria Reserva onde não há movimento de reserva e converte também os já ignorados", async () => {
    const vazio = await setup("bkf2");
    await prisma.transaction.create({
      data: {
        workspaceId: vazio.ws.id, type: "expense", amountCents: 500, date: new Date("2026-09-10"), accountId: vazio.mp.id,
        description: "Pix enviado para ASSAI", source: "import", importFingerprint: "bk2-1", createdById: vazio.ws.createdById,
      },
    });
    const com = await setup("bkf3");
    await prisma.transaction.create({
      data: {
        workspaceId: com.ws.id, type: "expense", amountCents: 350, date: new Date("2026-09-10"), accountId: com.mp.id, ignored: true,
        description: "Reserva por gastos Reserva Emergência", source: "import", importFingerprint: "bk3-1", createdById: com.ws.createdById,
      },
    });
    await runScript();
    expect(await prisma.bankAccount.count({ where: { workspaceId: vazio.ws.id, type: "savings" } })).toBe(0);
    const reserva = await prisma.bankAccount.findFirstOrThrow({ where: { workspaceId: com.ws.id, type: "savings" } });
    const tx = await prisma.transaction.findFirstOrThrow({ where: { workspaceId: com.ws.id } });
    expect(tx).toMatchObject({ type: "transfer", ignored: false, destAccountId: reserva.id });
  });
});
