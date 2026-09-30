import { describe, it, expect } from "vitest";
import {
  c6StatementParser, ofxStatementParser, detectStatement, verifyBalances, StatementParseError, parseOfx,
} from "../index";
import { C6_SAMPLE, c6SampleText } from "../parsers/__fixtures__/c6-sample";

describe("c6StatementParser.detect", () => {
  it("reconhece o layout e extrai a conta", () => {
    expect(c6StatementParser.detect(c6SampleText())).toEqual({
      institution: "c6", kind: "statement", format: "pdf_statement", accountRef: C6_SAMPLE.conta, confidence: 0.85,
    });
  });

  it("não reconhece texto qualquer", () => {
    expect(c6StatementParser.detect("Compra Netflix 15/06/2026 R$ 55,90")).toBeNull();
  });

  it("sobe a confiança quando o texto cita C6 Bank", () => {
    expect(c6StatementParser.detect(`${c6SampleText()}\nNo app do C6 Bank`)?.confidence).toBe(0.95);
  });
});

describe("c6StatementParser.parse", () => {
  const parsed = c6StatementParser.parse(c6SampleText(), { accountId: "acc1" });

  it("lê as 9 linhas com tipo, valor positivo, data de lançamento e contábil", () => {
    expect(parsed.rows).toHaveLength(C6_SAMPLE.rowCount);
    expect(parsed.rows[0]).toMatchObject({
      type: "income", amountCents: 100000, date: "2025-10-02", postedDate: "2025-10-02",
      description: "Pix recebido de Cliente A",
    });
    expect(parsed.rows[1]).toMatchObject({ type: "expense", amountCents: 25050 });
  });

  it("infere o ano pelo bloco mensal, inclusive para a data contábil do mês seguinte", () => {
    const fatura = parsed.rows.find((r) => r.description === "PGTO FAT CARTAO C6");
    expect(fatura).toMatchObject({ date: "2025-10-30", postedDate: "2025-11-01", type: "expense", amountCents: 30000 });
  });

  it("lê período, conta e os pontos de saldo (Saldo do dia + saldo do cabeçalho)", () => {
    expect(parsed.period).toEqual(C6_SAMPLE.period);
    expect(parsed.accountRef).toBe(C6_SAMPLE.conta);
    expect([...parsed.balances].sort((a, b) => a.dateISO.localeCompare(b.dateISO))).toEqual(C6_SAMPLE.balances);
  });

  it("duas linhas idênticas no mesmo dia têm fingerprints diferentes", () => {
    const padarias = parsed.rows.filter((r) => r.description === "Pix enviado para Padaria");
    expect(padarias).toHaveLength(2);
    expect(padarias[0].fingerprint).not.toBe(padarias[1].fingerprint);
    expect(new Set(parsed.rows.map((r) => r.fingerprint)).size).toBe(parsed.rows.length);
  });

  it("os saldos declarados fecham com as linhas (conferência por data contábil)", () => {
    const check = verifyBalances(parsed.rows, parsed.balances);
    expect(check?.ok).toBe(true);
    expect(check?.checkpoints).toBe(C6_SAMPLE.checkpoints);
  });

  it("reimportar o mesmo texto gera os mesmos fingerprints", () => {
    const again = c6StatementParser.parse(c6SampleText(), { accountId: "acc1" });
    expect(again.rows.map((r) => r.fingerprint)).toEqual(parsed.rows.map((r) => r.fingerprint));
  });

  it("o fingerprint depende da conta", () => {
    const other = c6StatementParser.parse(c6SampleText(), { accountId: "acc2" });
    expect(other.rows[0].fingerprint).not.toBe(parsed.rows[0].fingerprint);
  });

  it("um saldo do dia errado aparece como divergência (esperado − calculado)", () => {
    const bad = c6StatementParser.parse(c6SampleText({ corruptBalance: true }), { accountId: "acc1" });
    const check = verifyBalances(bad.rows, bad.balances);
    expect(check?.ok).toBe(false);
    expect(check?.mismatches.map((m) => [m.dateISO, m.diffCents])).toEqual([
      ["2025-10-29", 950],
      ["2025-11-03", -950],
    ]);
  });

  it("aceita o texto no formato pdftotext -layout (colunas por 2+ espaços)", () => {
    const layout = c6StatementParser.parse(c6SampleText({ layout: true }), { accountId: "acc1" });
    expect(layout.rows.map((r) => [r.date, r.postedDate, r.type, r.amountCents, r.description])).toEqual(
      parsed.rows.map((r) => [r.date, r.postedDate, r.type, r.amountCents, r.description]),
    );
    expect(verifyBalances(layout.rows, layout.balances)?.ok).toBe(true);
  });

  it("uma linha que termina em tabulação ainda é lida (células vazias finais são descartadas)", () => {
    const text = c6SampleText().replace("Cliente A \tR$ 1.000,00", "Cliente A \tR$ 1.000,00 \t");
    expect(text).toContain("Cliente A \tR$ 1.000,00 \t\n");
    const tolerant = c6StatementParser.parse(text, { accountId: "acc1" });
    expect(tolerant.rows).toHaveLength(C6_SAMPLE.rowCount);
    expect(tolerant.rows[0]).toMatchObject({ type: "income", amountCents: 100000 });
  });

  it("lança StatementParseError para linha fora de um bloco mensal", () => {
    const text = "02/10 \t02/10 \tEntrada PIX \tPix \tR$ 1,00";
    expect(() => c6StatementParser.parse(text, { accountId: "a" })).toThrow(StatementParseError);
  });

  it("lança StatementParseError quando não encontra nenhum lançamento nem saldo", () => {
    expect(() => c6StatementParser.parse("nada aqui", { accountId: "a" })).toThrow(StatementParseError);
  });
});

const OFX_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0077<ACCTID>98765-4</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260605120000[-3:BRT]
<TRNAMT>-35.00
<FITID>A1
<MEMO>iFood Pagamento
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260610
<TRNAMT>5000,00
<FITID>A2
<NAME>Salário
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260611
<TRNAMT>-10.00
<MEMO>Sem FITID
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260611
<TRNAMT>-10.00
<MEMO>Sem FITID
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1234.56<DTASOF>20260630</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("ofxStatementParser", () => {
  it("detecta banco pelo BANKID, conta pelo ACCTID e formato ofx", () => {
    expect(ofxStatementParser.detect(OFX_SAMPLE)).toEqual({
      institution: "inter", kind: "statement", format: "ofx", accountRef: "98765-4", confidence: 0.95,
    });
  });

  it("mapeia BANKID conhecidos e cai em other nos demais", () => {
    const at = (id: string) => ofxStatementParser.detect(`<OFX><BANKID>${id}<ACCTID>1</OFX>`)?.institution;
    expect(at("001")).toBe("bb");
    expect(at("336")).toBe("c6");
    expect(at("323")).toBe("mercado_pago");
    expect(at("999")).toBe("other");
  });

  it("cartão: CCACCTFROM vira card_invoice", () => {
    const d = ofxStatementParser.detect("<OFX><CREDITCARDMSGSRSV1><CCACCTFROM><ACCTID>4321</CCACCTFROM></OFX>");
    expect(d).toMatchObject({ kind: "card_invoice", accountRef: "4321", format: "ofx" });
  });

  it("não detecta texto que não é OFX", () => {
    expect(ofxStatementParser.detect("Data;Valor\n01/01/2026;10,00")).toBeNull();
  });

  it("parse: linhas, sinal, data, vírgula decimal e memo/name", () => {
    const parsed = ofxStatementParser.parse(OFX_SAMPLE, { accountId: "acc1" });
    expect(parsed.rows.map((r) => [r.type, r.amountCents, r.date, r.description])).toEqual([
      ["expense", 3500, "2026-06-05", "iFood Pagamento"],
      ["income", 500000, "2026-06-10", "Salário"],
      ["expense", 1000, "2026-06-11", "Sem FITID"],
      ["expense", 1000, "2026-06-11", "Sem FITID"],
    ]);
    expect(parsed.accountRef).toBe("98765-4");
    expect(parsed.period).toEqual({ from: "2026-06-05", to: "2026-06-11" });
  });

  it("fingerprint: FITID vira ofx:{conta}:{fitid}; sem FITID usa chave com ordinal (linhas iguais não colidem)", () => {
    const rows = ofxStatementParser.parse(OFX_SAMPLE, { accountId: "acc1" }).rows;
    expect(rows[0].fingerprint).toBe("ofx:acc1:A1");
    expect(rows[1].fingerprint).toBe("ofx:acc1:A2");
    expect(rows[2].fingerprint).toBe("acc1|2026-06-11|-1000|sem fitid|0");
    expect(rows[3].fingerprint).toBe("acc1|2026-06-11|-1000|sem fitid|1");
  });

  it("lê o saldo (BALAMT/DTASOF), que sozinho não permite conferência", () => {
    const parsed = ofxStatementParser.parse(OFX_SAMPLE, { accountId: "acc1" });
    expect(parsed.balances).toEqual([{ dateISO: "2026-06-30", balanceCents: 123456 }]);
    expect(verifyBalances(parsed.rows, parsed.balances)).toBeNull();
  });

  it("parseOfx deixa fitid nulo quando o arquivo não traz FITID", () => {
    expect(parseOfx(OFX_SAMPLE).map((t) => t.fitid)).toEqual(["A1", "A2", null, null]);
  });

  it("lança StatementParseError quando não há transações", () => {
    expect(() => ofxStatementParser.parse("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>", { accountId: "a" })).toThrow(
      StatementParseError,
    );
  });
});

describe("detectStatement", () => {
  it("escolhe o parser de maior confiança", () => {
    expect(detectStatement(c6SampleText())?.parser.id).toBe("c6-statement");
    expect(detectStatement(OFX_SAMPLE)?.parser.id).toBe("ofx");
    expect(detectStatement(OFX_SAMPLE)?.detected.institution).toBe("inter");
  });

  it("devolve null para texto não reconhecido", () => {
    expect(detectStatement("qualquer coisa")).toBeNull();
    expect(detectStatement("")).toBeNull();
  });
});
