import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { C6_SAMPLE, c6SampleText } from "../../../../packages/shared/src/parsers/__fixtures__/c6-sample";
import { MP_SAMPLE, mercadoPagoSampleText } from "../../../../packages/shared/src/parsers/__fixtures__/mercado-pago-sample";

// PDFs de verdade não podem ser gerados no teste: o extrator é simulado e devolve o texto pedido.
const pdfState = vi.hoisted(() => ({ text: "" }));
vi.mock("../../src/import/pdf-text", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/import/pdf-text")>();
  return { ...real, extractPdfText: async () => pdfState.text };
});

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

async function newAccount(u: User, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST", url: "/accounts", headers: u.h,
    payload: { type: "checking", name: "C6 PJ", entity: "pj", institution: "c6", ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const PDF_BYTES = b64("%PDF-1.4\n% fake");

const post = (u: User, url: string, payload: unknown) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });

async function previewC6(u: User, accountId: string, text = c6SampleText()) {
  const res = await post(u, "/import/preview", { accountId, text, format: "pdf_statement" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function commitPayload(rows: Array<Record<string, unknown>>, accountId: string) {
  return {
    rows: rows.map((r) => ({
      type: r.type, amountCents: r.amountCents, date: r.date, postedDate: r.postedDate,
      description: r.description, fingerprint: r.fingerprint, accountId,
    })),
  };
}

/** Extrato C6 sintético mínimo: blocos mensais com linhas [lançamento, contábil, tipo, descrição, valor]. */
function c6Extract(blocks: Array<{ title: string; from: string; to: string; rows: string[][] }>): string {
  const cell = (...c: string[]) => c.join(" \t");
  return [
    "Extrato exportado no dia 30 de setembro de 2026 às 10:00",
    "FULANO DE TESTE • 000.000.000-00",
    `Agência: 1 • Conta: ${C6_SAMPLE.conta}`,
    "Saldo do dia • 30 de setembro de 2026 • R$ 0,00",
    ...blocks.flatMap((b) => [
      `${b.title} ( ${b.from} - ${b.to} ) \tEntradas: R$ 0,00 • Saídas: R$ 0,00`,
      "Data",
      "lançamento",
      "Data",
      cell("contábil", "Tipo", "Descrição", "Valor"),
      ...b.rows.map((r) => cell(...r)),
    ]),
  ].join("\n");
}

const MAIO = {
  title: "Maio 2026", from: "01/05/2026", to: "31/05/2026",
  rows: [
    ["10/05", "10/05", "Saída PIX", "Pix enviado para A", "-R$ 100,00"],
    ["10/05", "10/05", "Saída PIX", "Pix enviado para A", "-R$ 100,00"], // idêntica à anterior, mesmo dia
    ["20/05", "20/05", "Entrada PIX", "Pix recebido de B", "R$ 50,00"],
  ],
};
const JUNHO = {
  title: "Junho 2026", from: "01/06/2026", to: "30/06/2026",
  rows: [["15/06", "15/06", "Saída PIX", "Pix enviado para C", "-R$ 30,00"]],
};
const JULHO = {
  title: "Julho 2026", from: "01/07/2026", to: "31/07/2026",
  rows: [["05/07", "05/07", "Saída PIX", "Pix enviado para D", "-R$ 10,00"]],
};
/** Dois extratos de períodos que se sobrepõem (maio e junho nos dois): o segundo só acrescenta julho. */
const OVERLAP_A = c6Extract([MAIO, JUNHO]);
const OVERLAP_B = c6Extract([MAIO, JUNHO, JULHO]);

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>077<ACCTID>555-1</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260605<TRNAMT>-35.00<FITID>F1<MEMO>Padaria São João</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260610<TRNAMT>100.00<FITID>F2<MEMO>Pix recebido</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("Fase 11 — POST /import/detect", () => {
  it("reconhece OFX Latin-1 (bytes), banco pelo BANKID e conta cadastrada pelo externalId", async () => {
    const u = await newUser("det1");
    const accountId = await newAccount(u, { institution: "inter", externalId: "555-1" });
    const res = await post(u, "/import/detect", { fileName: "extrato.ofx", contentBase64: b64(Buffer.from(OFX, "latin1")) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      format: "ofx", institution: "inter", kind: "statement", accountRef: "555-1", matchedAccountId: accountId,
    });
    expect(body.text).toContain("Padaria São João");
  });

  it("OFX sem conta cadastrada com aquele número não sugere conta", async () => {
    const u = await newUser("det2");
    await newAccount(u, { externalId: "outra" });
    const res = await post(u, "/import/detect", { fileName: "x.ofx", contentBase64: b64(OFX) });
    expect(res.json().matchedAccountId).toBeNull();
  });

  it("duas contas com o mesmo número: ambíguo, não sugere", async () => {
    const u = await newUser("det3");
    await newAccount(u, { externalId: "555-1", name: "A" });
    await newAccount(u, { externalId: "555-1", name: "B" });
    const res = await post(u, "/import/detect", { fileName: "x.ofx", contentBase64: b64(OFX) });
    expect(res.json().matchedAccountId).toBeNull();
  });

  it("PDF do C6: extrai o texto e reconhece o extrato e a conta", async () => {
    const u = await newUser("det4");
    const accountId = await newAccount(u, { externalId: C6_SAMPLE.conta });
    pdfState.text = c6SampleText();
    const res = await post(u, "/import/detect", { fileName: "Extrato.pdf", contentBase64: PDF_BYTES });
    expect(res.json()).toMatchObject({
      format: "pdf_statement", institution: "c6", kind: "statement", accountRef: C6_SAMPLE.conta, matchedAccountId: accountId,
    });
    expect(res.json().text).toContain("Saldo do dia");
  });

  it("PDF do Mercado Pago: reconhece o extrato e casa a conta cadastrada com hífen (compara só os dígitos)", async () => {
    const u = await newUser("det4mp");
    const other = await newUser("det4mp2");
    // mesma conta cadastrada em outro workspace, e conta arquivada no próprio: não contam
    await newAccount(other, { institution: "mercado_pago", externalId: MP_SAMPLE.conta });
    await newAccount(u, { institution: "mercado_pago", externalId: "outra-conta" });
    const archived = await newAccount(u, { institution: "mercado_pago", externalId: MP_SAMPLE.conta, name: "Antiga" });
    await prisma.bankAccount.update({ where: { id: archived }, data: { archived: true } });
    const digits = MP_SAMPLE.conta;
    const accountId = await newAccount(u, { institution: "mercado_pago", externalId: `${digits.slice(0, -1)}-${digits.slice(-1)}` });
    pdfState.text = mercadoPagoSampleText();
    const res = await post(u, "/import/detect", { fileName: "Extrato.pdf", contentBase64: PDF_BYTES });
    expect(res.json()).toMatchObject({
      format: "pdf_statement", institution: "mercado_pago", kind: "statement", accountRef: MP_SAMPLE.conta, matchedAccountId: accountId,
    });
  });

  it("PDF do Mercado Pago: duas contas ativas com os mesmos dígitos é ambíguo e não sugere", async () => {
    const u = await newUser("det4mp3");
    const digits = MP_SAMPLE.conta;
    await newAccount(u, { institution: "mercado_pago", externalId: digits, name: "A" });
    await newAccount(u, { institution: "mercado_pago", externalId: `${digits.slice(0, -1)}-${digits.slice(-1)}`, name: "B" });
    pdfState.text = mercadoPagoSampleText();
    const res = await post(u, "/import/detect", { fileName: "Extrato.pdf", contentBase64: PDF_BYTES });
    expect(res.json()).toMatchObject({ institution: "mercado_pago", matchedAccountId: null });
  });

  it("PDF de banco desconhecido: format pdf (caminho de IA), sem texto devolvido", async () => {
    const u = await newUser("det5");
    pdfState.text = "Compra Netflix 15/06/2026 R$ 55,90";
    const res = await post(u, "/import/detect", { fileName: "fatura.pdf", contentBase64: PDF_BYTES });
    expect(res.json()).toMatchObject({ format: "pdf", institution: null, text: null, matchedAccountId: null });
  });

  it("CSV e arquivo desconhecido", async () => {
    const u = await newUser("det6");
    const csv = await post(u, "/import/detect", { fileName: "mov.csv", contentBase64: b64("Data,Valor,Descricao\n01/06/2026,-10,x\n") });
    expect(csv.json().format).toBe("csv");
    const unk = await post(u, "/import/detect", { fileName: "foto.bin", contentBase64: b64("oi") });
    expect(unk.json().format).toBe("unknown");
  });

  it("arquivo vazio ou base64 ausente retornam 400", async () => {
    const u = await newUser("det7");
    expect((await post(u, "/import/detect", { fileName: "a.ofx", contentBase64: "" })).statusCode).toBe(400);
    expect((await post(u, "/import/detect", { fileName: "a.ofx" })).statusCode).toBe(400);
  });
});

describe("Fase 11 — POST /import/preview e commit (extrato C6)", () => {
  it("preview traz linhas, batch com instituição/conta detectada e saldos conferidos", async () => {
    const u = await newUser("prev1");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId);

    expect(body).toMatchObject({ institution: "c6", accountRef: C6_SAMPLE.conta, rowCount: C6_SAMPLE.rowCount, dupCount: 0 });
    expect(body.period).toEqual(C6_SAMPLE.period);
    // o cabeçalho do C6 declara o saldo corrente (R$ 500,00 em 5/11/2025)
    expect(body.statementBalance).toEqual({ dateISO: "2025-11-05", balanceCents: 50000, current: true });
    expect(body.balanceCheck).toMatchObject({ ok: true, checkpoints: C6_SAMPLE.checkpoints, mismatches: [] });
    expect(body.rows[0]).toMatchObject({ type: "income", amountCents: 100000, date: "2025-10-02", accountId, dup: false });

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.batchId } });
    expect(batch).toMatchObject({
      format: "pdf_statement", institution: "c6", detectedAccountRef: C6_SAMPLE.conta, status: "preview", rowCount: 9, dupCount: 0,
    });
    expect((batch.balanceCheck as { ok: boolean }).ok).toBe(true);
  });

  it("commit grava as 9 linhas, inclusive as duas idênticas no mesmo dia, e a data contábil", async () => {
    const u = await newUser("prev2");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId);
    const res = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inserted: 9, skipped: 0 });

    const padarias = await prisma.transaction.count({ where: { workspaceId: u.workspaceId, description: "Pix enviado para Padaria" } });
    expect(padarias).toBe(2);
    const fatura = await prisma.transaction.findFirstOrThrow({ where: { workspaceId: u.workspaceId, description: "PGTO FAT CARTAO C6" } });
    expect(fatura.date.toISOString().slice(0, 10)).toBe("2025-10-29");
    expect(fatura.postedDate?.toISOString().slice(0, 10)).toBe("2025-11-01");
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: body.batchId } })).status).toBe("committed");
  });

  it("extrato do Mercado Pago: preview confere os saldos, commit grava tudo e reimportar marca duplicatas", async () => {
    const u = await newUser("prevmp");
    const accountId = await newAccount(u, { institution: "mercado_pago", externalId: MP_SAMPLE.conta });
    const text = mercadoPagoSampleText();
    const res = await post(u, "/import/preview", { accountId, text, format: "pdf_statement" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ institution: "mercado_pago", accountRef: MP_SAMPLE.conta, rowCount: MP_SAMPLE.rowCount, dupCount: 0 });
    expect(body.period).toEqual(MP_SAMPLE.period);
    expect(body.balanceCheck).toMatchObject({ ok: true, mismatches: [] });
    const commit = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(commit.json()).toEqual({ inserted: MP_SAMPLE.rowCount, skipped: 0 });

    const again = (await post(u, "/import/preview", { accountId, text, format: "pdf_statement" })).json();
    expect(again.dupCount).toBe(MP_SAMPLE.rowCount);

    // totais do cabeçalho que não fecham: 422 sem conteúdo do extrato
    const bad = await post(u, "/import/preview", { accountId, text: mercadoPagoSampleText({ incomesDelta: 1 }), format: "pdf_statement" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().message).toBe("total de entradas não confere com o cabeçalho");
  });

  it("reimportar o mesmo arquivo marca tudo como duplicata e não insere nada", async () => {
    const u = await newUser("prev3");
    const accountId = await newAccount(u);
    const first = await previewC6(u, accountId);
    await post(u, `/import/${first.batchId}/commit`, commitPayload(first.rows, accountId));

    const second = await previewC6(u, accountId);
    expect(second.dupCount).toBe(9);
    expect(second.rows.every((r: { dup: boolean }) => r.dup)).toBe(true);

    const res = await post(u, `/import/${second.batchId}/commit`, commitPayload(second.rows, accountId));
    expect(res.json()).toEqual({ inserted: 0, skipped: 9 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(9);
  });

  it("saldo errado no arquivo vira divergência no preview, sem bloquear", async () => {
    const u = await newUser("prev4");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId, c6SampleText({ corruptBalance: true }));
    expect(body.balanceCheck.ok).toBe(false);
    expect(body.balanceCheck.mismatches.map((m: { dateISO: string; diffCents: number }) => [m.dateISO, m.diffCents])).toEqual([
      ["2025-10-29", 950],
      ["2025-11-03", -950],
    ]);
    expect(body.rowCount).toBe(9);
  });

  it("texto não reconhecido retorna 422; conta de outro workspace retorna 404", async () => {
    const a = await newUser("prev5a");
    const b = await newUser("prev5b");
    const accountA = await newAccount(a);
    expect((await post(a, "/import/preview", { accountId: accountA, text: "texto qualquer", format: "pdf_statement" })).statusCode).toBe(422);
    expect((await post(b, "/import/preview", { accountId: accountA, text: c6SampleText(), format: "pdf_statement" })).statusCode).toBe(404);
  });

  it("OFX: preview usa ofx:{conta}:{FITID} e detecta duplicata depois do commit", async () => {
    const u = await newUser("prev6");
    const accountId = await newAccount(u, { institution: "inter" });
    const first = await post(u, "/import/preview", { accountId, text: OFX, format: "ofx" });
    expect(first.statusCode).toBe(200);
    expect(first.json().rows.map((r: { fingerprint: string }) => r.fingerprint)).toEqual([`ofx:${accountId}:F1`, `ofx:${accountId}:F2`]);
    expect(first.json().balanceCheck).toBeNull();
    expect(first.json().statementBalance).toBeNull(); // ponto de saldo sem a marca `current`: não se adivinha

    await post(u, `/import/${first.json().batchId}/commit`, commitPayload(first.json().rows, accountId));
    const second = await post(u, "/import/preview", { accountId, text: OFX, format: "ofx" });
    expect(second.json().dupCount).toBe(2);
  });

  it("commit recusa linhas com conta de outro workspace (400)", async () => {
    const a = await newUser("prev7a");
    const b = await newUser("prev7b");
    const accountA = await newAccount(a);
    const accountB = await newAccount(b);
    const body = await previewC6(b, accountB);
    const res = await post(b, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountA));
    expect(res.statusCode).toBe(400);
    expect(await prisma.transaction.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
  });

  it("confirmar o mesmo lote duas vezes responde 409 e não insere nada", async () => {
    const u = await newUser("recommit");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId);
    const first = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(first.statusCode).toBe(200);
    const again = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(again.statusCode).toBe(409);
    expect(await prisma.transaction.count({ where: { importBatchId: body.batchId } })).toBe(first.json().inserted);
  });

  it("linhas de outra conta do mesmo workspace são recusadas (400)", async () => {
    const u = await newUser("outraconta");
    const accountId = await newAccount(u);
    const other = await newAccount(u, { name: "Outra" });
    const body = await previewC6(u, accountId);
    const res = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, other));
    expect(res.statusCode).toBe(400);
  });

  it("a purga de previews antigos apaga o lote de extrato mas preserva o de PDF", async () => {
    const u = await newUser("purga");
    const accountId = await newAccount(u);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    const base = { workspaceId: u.workspaceId, accountId, status: "preview" as const, createdAt: twoDaysAgo, createdById: u.userId };
    const stmt = await prisma.importBatch.create({ data: { ...base, format: "pdf_statement" } });
    const pdf = await prisma.importBatch.create({ data: { ...base, format: "pdf" } });
    await previewC6(u, accountId);
    expect(await prisma.importBatch.findUnique({ where: { id: stmt.id } })).toBeNull();
    expect(await prisma.importBatch.findUnique({ where: { id: pdf.id } })).not.toBeNull();
  });
});

describe("Fase 11 — extratos com períodos sobrepostos", () => {
  const dups = (rows: Array<{ dup: boolean }>) => rows.map((r) => r.dup);

  it("o segundo extrato só acrescenta o que é novo: não sobrescreve nem duplica", async () => {
    const u = await newUser("ovl1");
    const accountId = await newAccount(u);

    const a = await previewC6(u, accountId, OVERLAP_A);
    expect(a.rowCount).toBe(4);
    await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));

    const b = await previewC6(u, accountId, OVERLAP_B);
    expect(b.rowCount).toBe(5);
    expect(b.dupCount).toBe(4);
    expect(dups(b.rows)).toEqual([true, true, true, true, false]);

    const res = await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));
    expect(res.json()).toEqual({ inserted: 1, skipped: 4 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(5);
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId, description: "Pix enviado para A" } })).toBe(2);
  });

  it("a ordem de importação não importa: o extrato maior primeiro torna o menor 100% duplicado", async () => {
    const u = await newUser("ovl2");
    const accountId = await newAccount(u);
    const b = await previewC6(u, accountId, OVERLAP_B);
    await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));

    const a = await previewC6(u, accountId, OVERLAP_A);
    expect(a.dupCount).toBe(4);
    const res = await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));
    expect(res.json()).toEqual({ inserted: 0, skipped: 4 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(5);
  });

  it("a categoria ajustada depois da 1ª importação sobrevive ao 2º extrato", async () => {
    const u = await newUser("ovl3");
    const accountId = await newAccount(u);
    const a = await previewC6(u, accountId, OVERLAP_A);
    await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));

    const category = await prisma.category.findFirstOrThrow({ where: { workspaceId: u.workspaceId, type: "income" } });
    const before = await prisma.transaction.findFirstOrThrow({ where: { workspaceId: u.workspaceId, description: "Pix recebido de B" } });
    await prisma.transaction.update({ where: { id: before.id }, data: { categoryId: category.id } });

    const b = await previewC6(u, accountId, OVERLAP_B);
    await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.categoryId).toBe(category.id);
    expect(after.importBatchId).toBe(a.batchId); // a linha continua pertencendo ao primeiro lote
  });
});

describe("Fase 11 — CSV com fingerprint por ordinal e compatibilidade com o legado", () => {
  const MAPPING = {
    dateColumn: "Data", amountColumn: "Valor", descriptionColumn: "Descricao",
    dateFormat: "DD/MM/YYYY", decimalSeparator: ".", expenseIsNegative: true,
  };
  const CSV = "Data,Valor,Descricao\n05/06/2026,-35.00,iFood\n05/06/2026,-35.00,iFood\n10/06/2026,1000.00,Salário";

  it("duas linhas idênticas no mesmo dia são as duas importadas", async () => {
    const u = await newUser("csv1");
    const accountId = await newAccount(u);
    const pre = await post(u, "/import/csv/preview", { accountId, mapping: MAPPING, csv: CSV });
    expect(pre.json()).toMatchObject({ rowCount: 3, dupCount: 0 });
    const fps = pre.json().rows.map((r: { fingerprint: string }) => r.fingerprint);
    expect(new Set(fps).size).toBe(3);

    const commit = await post(u, `/import/${pre.json().batchId}/commit`, commitPayload(pre.json().rows, accountId));
    expect(commit.json()).toEqual({ inserted: 3, skipped: 0 });

    const again = await post(u, "/import/csv/preview", { accountId, mapping: MAPPING, csv: CSV });
    expect(again.json().dupCount).toBe(3);
  });

  it("transação gravada com a chave legada (sem ordinal) ainda marca a primeira linha como duplicata", async () => {
    const u = await newUser("csv2");
    const accountId = await newAccount(u);
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, type: "expense", amountCents: 3500n, date: new Date("2026-06-05"), accountId,
        source: "import", createdById: u.userId, importFingerprint: `${accountId}|2026-06-05|-3500|ifood`,
      },
    });
    const pre = await post(u, "/import/csv/preview", { accountId, mapping: MAPPING, csv: CSV });
    const dups = pre.json().rows.map((r: { dup: boolean }) => r.dup);
    expect(dups).toEqual([true, false, false]);
  });
});

describe("Fase 11 — desfazer lote e histórico", () => {
  async function importC6(u: User, accountId: string) {
    const body = await previewC6(u, accountId);
    const commit = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(commit.json().inserted).toBe(9);
    return body.batchId as string;
  }

  it("undo apaga as transações do lote, marca undoneAt e libera a reimportação", async () => {
    const u = await newUser("undo1");
    const accountId = await newAccount(u);
    const batchId = await importC6(u, accountId);

    const res = await post(u, `/import/${batchId}/undo`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removed: 9 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).undoneAt).not.toBeNull();

    const again = await previewC6(u, accountId);
    expect(again.dupCount).toBe(0);
  });

  it("undo só mexe nas transações do próprio lote", async () => {
    const u = await newUser("undo2");
    const accountId = await newAccount(u);
    await prisma.transaction.create({
      data: { workspaceId: u.workspaceId, type: "expense", amountCents: 100n, date: new Date("2026-01-01"), accountId, source: "manual", createdById: u.userId },
    });
    const batchId = await importC6(u, accountId);
    await post(u, `/import/${batchId}/undo`, {});
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(1);
  });

  it("undo duas vezes retorna 409; lote só em preview retorna 409; lote de outro workspace retorna 404", async () => {
    const a = await newUser("undo3a");
    const b = await newUser("undo3b");
    const accountId = await newAccount(a);
    const batchId = await importC6(a, accountId);
    expect((await post(a, `/import/${batchId}/undo`, {})).statusCode).toBe(200);
    expect((await post(a, `/import/${batchId}/undo`, {})).statusCode).toBe(409);

    const previewOnly = await previewC6(a, accountId);
    expect((await post(a, `/import/${previewOnly.batchId}/undo`, {})).statusCode).toBe(409);

    const other = await importC6(a, accountId);
    expect((await post(b, `/import/${other}/undo`, {})).statusCode).toBe(404);
  });

  it("desfazer o lote do extrato sobreposto remove só as linhas que ele inseriu", async () => {
    const u = await newUser("undo4");
    const accountId = await newAccount(u);
    const a = await previewC6(u, accountId, OVERLAP_A);
    await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));
    const b = await previewC6(u, accountId, OVERLAP_B);
    await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(5);

    const res = await post(u, `/import/${b.batchId}/undo`, {});
    expect(res.json()).toEqual({ removed: 1 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(4);
  });

  it("GET /import/batches lista só lotes confirmados, com contagem real, saldo e estado de desfeito", async () => {
    const u = await newUser("hist1");
    const accountId = await newAccount(u, { name: "C6 Empresa" });
    await previewC6(u, accountId); // só preview: não aparece
    const batchId = await importC6(u, accountId);

    let list = (await app.inject({ method: "GET", url: "/import/batches", headers: u.h })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: batchId, format: "pdf_statement", institution: "c6", accountName: "C6 Empresa",
      rowCount: 9, inserted: 9, balanceOk: true, undoneAt: null,
    });

    await post(u, `/import/${batchId}/undo`, {});
    list = (await app.inject({ method: "GET", url: "/import/batches", headers: u.h })).json();
    expect(list[0]).toMatchObject({ id: batchId, inserted: 0 });
    expect(list[0].undoneAt).not.toBeNull();
  });

  it("GET /import/batches é isolado por workspace", async () => {
    const a = await newUser("hist2a");
    const b = await newUser("hist2b");
    await importC6(a, await newAccount(a));
    const list = (await app.inject({ method: "GET", url: "/import/batches", headers: b.h })).json();
    expect(list).toEqual([]);
  });
});

describe("Fase 11 — endurecimento do commit", () => {
  const validRow = (accountId: string, over: Record<string, unknown> = {}) => ({
    type: "expense", amountCents: 1000, date: "2026-06-05", postedDate: null,
    accountId, description: "x", categoryId: null, fingerprint: `hard:${accountId}:${Math.random()}`, ...over,
  });

  async function emptyBatch(u: User, accountId: string) {
    const pre = await post(u, "/import/preview", { accountId, text: c6SampleText(), format: "pdf_statement" });
    return pre.json().batchId as string;
  }

  it("rejeita amountCents negativo com 400", async () => {
    const u = await newUser("hard1");
    const accountId = await newAccount(u);
    const batchId = await emptyBatch(u, accountId);
    const res = await post(u, `/import/${batchId}/commit`, { rows: [validRow(accountId, { amountCents: -5 })] });
    expect(res.statusCode).toBe(400);
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
  });

  it("rejeita data fora do formato ISO com 400", async () => {
    const u = await newUser("hard2");
    const accountId = await newAccount(u);
    const batchId = await emptyBatch(u, accountId);
    const res = await post(u, `/import/${batchId}/commit`, { rows: [validRow(accountId, { date: "31/12/2025" })] });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita corpo sem rows com 400", async () => {
    const u = await newUser("hard3");
    const accountId = await newAccount(u);
    const batchId = await emptyBatch(u, accountId);
    expect((await post(u, `/import/${batchId}/commit`, {})).statusCode).toBe(400);
  });

  it("aceita corpo válido que também carrega dup nas linhas", async () => {
    const u = await newUser("hard4");
    const accountId = await newAccount(u);
    const batchId = await emptyBatch(u, accountId);
    const res = await post(u, `/import/${batchId}/commit`, { rows: [validRow(accountId, { dup: false })] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inserted: 1, skipped: 0 });
  });

  it("linha sinalizada como duplicata pela chave legada do CSV não ganha uma segunda cópia", async () => {
    const u = await newUser("hard5");
    const accountId = await newAccount(u);
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, type: "expense", amountCents: 3500n, date: new Date("2026-06-05"), accountId,
        source: "import", createdById: u.userId, importFingerprint: `${accountId}|2026-06-05|-3500|ifood`,
      },
    });
    const mapping = {
      dateColumn: "Data", amountColumn: "Valor", descriptionColumn: "Descricao",
      dateFormat: "DD/MM/YYYY", decimalSeparator: ".", expenseIsNegative: true,
    };
    const csv = "Data,Valor,Descricao\n05/06/2026,-35.00,iFood\n05/06/2026,-35.00,iFood\n10/06/2026,1000.00,Salário";
    const pre = await post(u, "/import/csv/preview", { accountId, mapping, csv });
    expect(pre.json().rows.map((r: { dup: boolean }) => r.dup)).toEqual([true, false, false]);

    const res = await post(u, `/import/${pre.json().batchId}/commit`, commitPayload(pre.json().rows, accountId));
    expect(res.json()).toEqual({ inserted: 2, skipped: 1 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(3);
  });
});

describe("Fase 11 — correções da revisão da Task 5", () => {
  async function importC6(u: User, accountId: string) {
    const body = await previewC6(u, accountId);
    const commit = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(commit.json().inserted).toBe(9);
    return { batchId: body.batchId as string, rows: body.rows as Array<Record<string, unknown>> };
  }

  it("lote desfeito não pode ser confirmado de novo (409) e não deixa linhas órfãs", async () => {
    const u = await newUser("fix1");
    const accountId = await newAccount(u);
    const { batchId, rows } = await importC6(u, accountId);
    expect((await post(u, `/import/${batchId}/undo`, {})).statusCode).toBe(200);

    const res = await post(u, `/import/${batchId}/commit`, commitPayload(rows, accountId));
    expect(res.statusCode).toBe(409);
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
    expect((await post(u, `/import/${batchId}/undo`, {})).statusCode).toBe(409);
  });

  it("dois undos simultâneos: um 200 (removed 9) e um 409", async () => {
    const u = await newUser("fix2");
    const accountId = await newAccount(u);
    const { batchId } = await importC6(u, accountId);

    const results = await Promise.all([post(u, `/import/${batchId}/undo`, {}), post(u, `/import/${batchId}/undo`, {})]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const ok = results.find((r) => r.statusCode === 200)!;
    expect(ok.json()).toEqual({ removed: 9 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
  });

  it("commit recusa data inexistente (2026-13-45) com 400 e aceita data válida", async () => {
    const u = await newUser("fix3");
    const accountId = await newAccount(u);
    const pre = await previewC6(u, accountId);
    const row = (date: string) => ({
      type: "expense", amountCents: 1000, date, postedDate: null, accountId, description: "x", categoryId: null,
      fingerprint: `fix3:${accountId}:${date}`,
    });
    expect((await post(u, `/import/${pre.batchId}/commit`, { rows: [row("2026-13-45")] })).statusCode).toBe(400);
    expect((await post(u, `/import/${pre.batchId}/commit`, { rows: [row("2026-02-30")] })).statusCode).toBe(400);
    const ok = await post(u, `/import/${pre.batchId}/commit`, { rows: [row("2026-02-28")] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ inserted: 1, skipped: 0 });
  });

  it("preview de extrato marca dup a 1ª linha gravada só com a chave legada (igual ao commit)", async () => {
    const u = await newUser("fix4");
    const accountId = await newAccount(u);
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, type: "income", amountCents: 100000n, date: new Date("2025-10-02"), accountId,
        source: "import", createdById: u.userId, importFingerprint: `${accountId}|2025-10-02|100000|pix recebido de cliente a`,
      },
    });
    const body = await previewC6(u, accountId);
    expect(body.rows[0].dup).toBe(true);
    expect(body.dupCount).toBe(1);

    const res = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(res.json()).toEqual({ inserted: 8, skipped: 1 });
  });
});
