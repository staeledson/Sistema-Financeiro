import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { c6InvoiceText } from "../../../../packages/shared/src/parsers/__fixtures__/c6-invoice-sample";

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
  return { userId: u!.user.id, workspaceId: ws.id, h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" } };
}
type User = Awaited<ReturnType<typeof newUser>>;

const post = (u: User, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });
const get = (u: User, url: string) => app.inject({ method: "GET", url, headers: u.h });
const card = (u: User, extra: Record<string, unknown> = {}) =>
  prisma.bankAccount.create({
    data: { workspaceId: u.workspaceId, type: "credit_card", name: "Cartão", entity: "pf", ...extra } as never,
  });
const b64 = (s: string) => Buffer.from(s).toString("base64");

const TEXT = c6InvoiceText();
const preview = (u: User, accountId: string, cardRef?: string, text = TEXT) =>
  post(u, "/import/preview", { accountId, text, format: "csv_invoice", ...(cardRef ? { cardRef } : {}) });

type PreviewRow = {
  type: string; amountCents: number; date: string; postedDate?: string | null; accountId: string;
  description: string; fingerprint: string; categoryId: string | null; bankCategory: string | null; dup: boolean;
};
const commitPayload = (rows: PreviewRow[]) => ({
  rows: rows.map((r) => ({
    type: r.type, amountCents: r.amountCents, date: r.date, postedDate: r.postedDate, accountId: r.accountId,
    description: r.description, categoryId: r.categoryId, fingerprint: r.fingerprint,
  })),
});
const catId = async (u: User, name: string) =>
  (await prisma.category.findFirstOrThrow({ where: { workspaceId: u.workspaceId, name, type: "expense" } })).id;

describe("POST /import/detect com fatura CSV", () => {
  it("reconhece a fatura e casa cada final de cartão com a conta cujo externalId é o final", async () => {
    const u = await newUser("fat-det1");
    const c1111 = await card(u, { externalId: "1111" });
    await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "Corrente", externalId: "2222" } });
    const res = await post(u, "/import/detect", { fileName: "Fatura_2026-09-15.csv", contentBase64: b64(TEXT) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      format: "csv_invoice", institution: "c6", kind: "card_invoice",
      accountRef: null, matchedAccountId: null, accountRefs: ["1111", "2222"],
    });
    // 2222 é conta corrente: só cartão de crédito casa
    expect(body.matchedAccounts).toEqual({ "1111": c1111.id, "2222": null });
    expect(typeof body.text).toBe("string");
  });

  it("duas contas ativas com o mesmo final não sugerem nada; conta arquivada não conta", async () => {
    const u = await newUser("fat-det2");
    await card(u, { name: "A", externalId: "1111" });
    await card(u, { name: "B", externalId: "1111" });
    const unica = await card(u, { name: "C", externalId: "2222" });
    await card(u, { name: "D", externalId: "2222", archived: true });
    const res = await post(u, "/import/detect", { fileName: "f.csv", contentBase64: b64(TEXT) });
    expect(res.json().matchedAccounts).toEqual({ "1111": null, "2222": unica.id });
  });

  it("extrato comum continua devolvendo accountRefs vazio e matchedAccounts vazio", async () => {
    const u = await newUser("fat-det3");
    const res = await post(u, "/import/detect", { fileName: "x.csv", contentBase64: b64("a;b;c\n1;2;3\n") });
    expect(res.json()).toMatchObject({ format: "csv", accountRefs: [], matchedAccounts: {} });
  });
});

describe("POST /import/preview com fatura CSV", () => {
  it("com dois cartões exige cardRef (422) e cardRef inexistente também", async () => {
    const u = await newUser("fat-pre1");
    const c = await card(u);
    const sem = await preview(u, c.id);
    expect(sem.statusCode).toBe(422);
    expect(sem.json().message).toContain("mais de um cartão");
    expect((await preview(u, c.id, "9999")).statusCode).toBe(422);
    expect(await prisma.importBatch.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
  });

  it("com cardRef devolve só as linhas do cartão, categoria sugerida pelo banco e lote csv_invoice", async () => {
    const u = await newUser("fat-pre2");
    const c = await card(u, { externalId: "1111" });
    const res = await preview(u, c.id, "1111");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      institution: "c6", accountRef: "1111", rowCount: 7, dupCount: 0, balanceCheck: null,
      period: { from: "2026-09-05", to: "2026-09-15" },
    });
    const rows = body.rows as PreviewRow[];
    const byDesc = (prefix: string) => rows.filter((r) => r.description.startsWith(prefix));
    const restaurantes = await catId(u, "Restaurantes e delivery");
    for (const r of byDesc("CAFE CENTRAL")) expect(r).toMatchObject({ bankCategory: "Restaurante / Lanchonete / Bar", categoryId: restaurantes });
    expect(byDesc("LOJA MODA CENTRO")[0]).toMatchObject({ bankCategory: "Vestuário", categoryId: await catId(u, "Compras") });
    expect(byDesc("SERVICO STREAMING")[0]).toMatchObject({ categoryId: await catId(u, "Lazer") });
    // o pagamento (receita, categoria "-") nunca recebe sugestão
    const pagamento = byDesc("Pagamento recebido")[0];
    expect(pagamento).toMatchObject({ type: "income", bankCategory: null, categoryId: null });
    expect(rows.find((r) => r.description.startsWith("OFICINA"))).toBeUndefined(); // é do cartão 2222

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.batchId } });
    expect(batch).toMatchObject({ format: "csv_invoice", detectedAccountRef: "1111", accountId: c.id, status: "preview", rowCount: 7 });
  });

  it("categoria do banco que não mapeia (Elétrico) fica sem categoryId", async () => {
    const u = await newUser("fat-pre3");
    const c = await card(u, { externalId: "2222" });
    const body = (await preview(u, c.id, "2222")).json();
    const oficina = (body.rows as PreviewRow[]).find((r) => r.description.startsWith("OFICINA"))!;
    expect(oficina).toMatchObject({ bankCategory: "Elétrico", categoryId: null });
    const mercado = (body.rows as PreviewRow[]).find((r) => r.description.startsWith("MERCADO"))!;
    expect(mercado.categoryId).toBe(await catId(u, "Supermercado"));
  });

  it("arquivo de fatura só importa para conta de cartão de crédito (400); conta inexistente continua 404", async () => {
    const u = await newUser("fat-pre4");
    const corrente = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "Corrente" } });
    const res = await preview(u, corrente.id, "1111");
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("este arquivo é uma fatura de cartão; escolha uma conta do tipo cartão de crédito");
    expect(await prisma.importBatch.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
    expect((await preview(u, "nao-existe", "1111")).statusCode).toBe(404);
  });

  it("OFX de cartão em conta que não é cartão também é recusado (400)", async () => {
    const u = await newUser("fat-pre5");
    const corrente = await prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name: "Corrente" } });
    const ofx = [
      "OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "", "<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>",
      "<CURDEF>BRL<CCACCTFROM><ACCTID>1111</CCACCTFROM>",
      "<BANKTRANLIST><DTSTART>20260901<DTEND>20260930",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260905<TRNAMT>-10.00<FITID>1<MEMO>LOJA</STMTTRN>",
      "</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>",
    ].join("\n");
    const res = await post(u, "/import/preview", { accountId: corrente.id, text: ofx, format: "ofx" });
    expect(res.statusCode).toBe(400);
  });

  it("com duas categorias de mesmo nome a sugestão é sempre a mesma (a de menor id)", async () => {
    const u = await newUser("fat-pre7");
    const c = await card(u, { externalId: "1111" });
    await prisma.category.create({ data: { workspaceId: u.workspaceId, name: "Restaurantes e delivery", type: "expense" } });
    const same = await prisma.category.findMany({ where: { workspaceId: u.workspaceId, name: "Restaurantes e delivery", type: "expense" } });
    expect(same).toHaveLength(2);
    const expected = same.map((x) => x.id).sort()[0];
    for (let i = 0; i < 3; i++) {
      const rows = (await preview(u, c.id, "1111")).json().rows as PreviewRow[];
      expect(rows.find((r) => r.description.startsWith("CAFE CENTRAL"))!.categoryId).toBe(expected);
    }
  });

  it("cartão PJ não recebe sugestão de categoria exclusiva de PF; both continua valendo", async () => {
    const u = await newUser("fat-pre6");
    const pj = await card(u, { entity: "pj", externalId: "2222" });
    await prisma.category.updateMany({ where: { workspaceId: u.workspaceId, name: "Supermercado" }, data: { entity: "pf" } });
    const body = (await preview(u, pj.id, "2222")).json();
    const mercado = (body.rows as PreviewRow[]).find((r) => r.description.startsWith("MERCADO"))!;
    expect(mercado).toMatchObject({ bankCategory: "Supermercados / Mercearias", categoryId: null });

    const pf = await card(u, { name: "Pessoal", entity: "pf" });
    const bodyPf = (await preview(u, pf.id, "2222")).json();
    expect((bodyPf.rows as PreviewRow[]).find((r) => r.description.startsWith("MERCADO"))!.categoryId).toBe(await catId(u, "Supermercado"));
  });
});

describe("commit da fatura por cartão", () => {
  it("grava categorySource, parcelas e dedupe; reimportar marca tudo como duplicata; undo de um lote não mexe no outro", async () => {
    const u = await newUser("fat-com1");
    const c1 = await card(u, { name: "Final 1111", externalId: "1111" });
    const c2 = await card(u, { name: "Final 2222", externalId: "2222" });

    const p1 = (await preview(u, c1.id, "1111")).json();
    const p2 = (await preview(u, c2.id, "2222")).json();
    expect(p1.batchId).not.toBe(p2.batchId);
    expect((await post(u, `/import/${p1.batchId}/commit`, commitPayload(p1.rows))).json()).toEqual({ inserted: 7, skipped: 0 });
    expect((await post(u, `/import/${p2.batchId}/commit`, commitPayload(p2.rows))).json()).toEqual({ inserted: 2, skipped: 0 });

    const txs1 = await prisma.transaction.findMany({ where: { workspaceId: u.workspaceId, accountId: c1.id } });
    expect(txs1).toHaveLength(7);
    const find = (list: typeof txs1, prefix: string) => list.filter((t) => t.description?.startsWith(prefix));
    for (const t of txs1.filter((t) => t.categoryId)) expect(t.categorySource).toBe("import");
    for (const t of txs1.filter((t) => !t.categoryId)) expect(t.categorySource).toBe("none");
    expect(find(txs1, "Pagamento recebido")[0]).toMatchObject({ type: "income", categoryId: null, categorySource: "none" });
    expect(find(txs1, "LOJA MODA CENTRO")[0]).toMatchObject({ installmentCurrent: 3, installmentTotal: 10, categorySource: "import" });
    expect(find(txs1, "MERCADO TECH")[0]).toMatchObject({ installmentCurrent: 2, installmentTotal: 6 });
    expect(find(txs1, "CAFE CENTRAL")).toHaveLength(2); // linhas idênticas viram duas transações
    expect(find(txs1, "SERVICO STREAMING")[0].description).toBe("SERVICO STREAMING (US$ 5.00 @ 5.44)");
    const txs2 = await prisma.transaction.findMany({ where: { workspaceId: u.workspaceId, accountId: c2.id } });
    expect(txs2).toHaveLength(2);
    expect(txs2.find((t) => t.description?.startsWith("OFICINA"))).toMatchObject({ categoryId: null, categorySource: "none" });

    // reimportar o mesmo arquivo para o mesmo cartão: tudo duplicata e nada novo
    const again = (await preview(u, c1.id, "1111")).json();
    expect(again).toMatchObject({ rowCount: 7, dupCount: 7 });
    expect((await post(u, `/import/${again.batchId}/commit`, commitPayload(again.rows))).json()).toEqual({ inserted: 0, skipped: 7 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId, accountId: c1.id } })).toBe(7);

    // desfazer o lote do cartão 1111 não toca o do 2222
    const undo = await post(u, `/import/${p1.batchId}/undo`);
    expect(undo.json()).toEqual({ removed: 7 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId, accountId: c1.id } })).toBe(0);
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId, accountId: c2.id } })).toBe(2);

    const batches = (await get(u, "/import/batches")).json() as Array<{ format: string; accountName: string }>;
    expect(batches.filter((b) => b.format === "csv_invoice").map((b) => b.accountName).sort()).toEqual(["Final 1111", "Final 1111", "Final 2222"]); // inclui o lote da reimportação, confirmado com 0 linhas novas
  });

  it("o mesmo texto para outro cartão (outra conta) não colide com o primeiro", async () => {
    const u = await newUser("fat-com2");
    const a = await card(u, { name: "A" });
    const b = await card(u, { name: "B" });
    const pa = (await preview(u, a.id, "1111")).json();
    await post(u, `/import/${pa.batchId}/commit`, commitPayload(pa.rows));
    const pb = (await preview(u, b.id, "1111")).json();
    expect(pb.dupCount).toBe(0);
  });
});

describe("GET /dashboard/cards com pagamento de fatura sem par", () => {
  const AS_OF = "asOf=2026-06-20";
  const dayOf = (iso: string) => new Date(`${iso}T00:00:00Z`);

  async function seed(tag: string) {
    const u = await newUser(tag);
    const c = await card(u, { closingDay: 10, dueDay: 17, creditLimitCents: 500000n, openingBalanceCents: 0n });
    const tx = (data: Record<string, unknown>) =>
      prisma.transaction.create({ data: { workspaceId: u.workspaceId, accountId: c.id, source: "import", createdById: u.userId, ...data } as never });
    await tx({ type: "expense", amountCents: 40000n, date: dayOf("2026-05-20"), description: "Compra maio" }); // fatura de 10/06
    await tx({ type: "expense", amountCents: 10000n, date: dayOf("2026-06-12"), description: "MERCADO" }); // ciclo aberto
    return { u, tx };
  }

  it("receita sem par com texto de pagamento conta como pago e não reduz a fatura aberta", async () => {
    const { u, tx } = await seed("fat-cd1");
    await tx({ type: "income", amountCents: 40000n, date: dayOf("2026-06-14"), description: "Pagamento CDB" });
    const { cards } = (await get(u, `/dashboard/cards?${AS_OF}`)).json();
    expect(cards[0].openInvoiceCents).toBe(10000);
    expect(cards[0].invoicePayments).toEqual([
      { closing: "2026-06-10", due: "2026-06-17", invoiceCents: 40000, paidCents: 40000, status: "paid" },
    ]);
  });

  it("estorno comum (sem par e sem texto de pagamento) continua reduzindo a fatura", async () => {
    const { u, tx } = await seed("fat-cd2");
    await tx({ type: "income", amountCents: 3000n, date: dayOf("2026-06-18"), description: "Estorno Loja X" });
    const { cards } = (await get(u, `/dashboard/cards?${AS_OF}`)).json();
    expect(cards[0].openInvoiceCents).toBe(7000);
    expect(cards[0].invoicePayments).toEqual([
      { closing: "2026-06-10", due: "2026-06-17", invoiceCents: 40000, paidCents: 0, status: "overdue" },
    ]);
  });
});
