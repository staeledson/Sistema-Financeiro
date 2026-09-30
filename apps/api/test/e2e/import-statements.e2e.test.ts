import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { C6_SAMPLE, c6SampleText } from "../../../../packages/shared/src/parsers/__fixtures__/c6-sample";

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
