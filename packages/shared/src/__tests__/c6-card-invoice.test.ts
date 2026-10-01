import { describe, it, expect } from "vitest";
import {
  c6CardInvoiceParser, c6StatementParser, ofxStatementParser, detectStatement, STATEMENT_PARSERS,
  StatementParseError, parseInstallment,
} from "../index";
import { c6InvoiceText, C6_INVOICE_HEADER, C6_INVOICE_ROWS } from "../parsers/__fixtures__/c6-invoice-sample";
import { c6SampleText } from "../parsers/__fixtures__/c6-sample";

const NAME = "NOME TITULAR";
const parse = (cardRef: string | null, text = c6InvoiceText(), accountId = "acc1") =>
  c6CardInvoiceParser.parse(text, { accountId, cardRef });

describe("c6CardInvoiceParser.detect", () => {
  it("reconhece o cabeçalho com e sem BOM, LF e CRLF", () => {
    for (const opts of [{}, { bom: true }, { crlf: true }, { bom: true, crlf: true }]) {
      const d = c6CardInvoiceParser.detect(c6InvoiceText(opts));
      expect(d).not.toBeNull();
      expect(d?.institution).toBe("c6");
      expect(d?.kind).toBe("card_invoice");
      expect(d?.format).toBe("csv_invoice");
      expect(d?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(d?.accountRefs).toEqual(["1111", "2222"]);
      expect(d?.accountRef).toBeNull();
    }
  });

  it("com um único cartão preenche accountRef", () => {
    const rows = C6_INVOICE_ROWS.filter((r) => r.includes(";1111;"));
    const d = c6CardInvoiceParser.detect(c6InvoiceText({ rows }));
    expect(d?.accountRef).toBe("1111");
    expect(d?.accountRefs).toEqual(["1111"]);
  });

  it("não reconhece extrato em texto de PDF, OFX nem CSV de outro formato", () => {
    expect(c6CardInvoiceParser.detect(c6SampleText())).toBeNull();
    expect(c6CardInvoiceParser.detect("OFXHEADER:100\n<OFX><STMTTRN></STMTTRN></OFX>")).toBeNull();
    expect(c6CardInvoiceParser.detect("data;descricao;valor\n01/01/2026;x;1.00\n")).toBeNull();
    expect(c6CardInvoiceParser.detect("")).toBeNull();
  });

  it("os outros parsers não reconhecem o CSV e detectStatement escolhe a fatura", () => {
    const text = c6InvoiceText();
    expect(c6StatementParser.detect(text)).toBeNull();
    expect(ofxStatementParser.detect(text)).toBeNull();
    expect(detectStatement(text)?.parser).toBe(c6CardInvoiceParser);
    expect(STATEMENT_PARSERS).toContain(c6CardInvoiceParser);
  });
});

describe("c6CardInvoiceParser.parse: escolha do cartão", () => {
  it("com 2 cartões e sem cardRef falha sem conteúdo de linha", () => {
    let err: unknown;
    try { parse(null); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(StatementParseError);
    expect((err as Error).message).toBe("o arquivo tem mais de um cartão; escolha o final do cartão");
  });

  it("cardRef inexistente falha", () => {
    expect(() => parse("9999")).toThrow(StatementParseError);
  });

  it("com cardRef só devolve as linhas desse cartão", () => {
    const p = parse("1111");
    expect(p.accountRef).toBe("1111");
    expect(p.rows.every((r) => r.cardRef === "1111")).toBe(true);
    expect(p.rows.map((r) => r.description)).not.toContain("MERCADO BOM PRECO");
    const q = parse("2222");
    expect(q.rows).toHaveLength(2);
  });

  it("com um único cartão dispensa cardRef", () => {
    const rows = C6_INVOICE_ROWS.filter((r) => r.includes(";2222;"));
    const p = c6CardInvoiceParser.parse(c6InvoiceText({ rows }), { accountId: "a" });
    expect(p.rows).toHaveLength(2);
    expect(p.accountRef).toBe("2222");
  });
});

describe("c6CardInvoiceParser.parse: valores", () => {
  const p = parse("1111");
  const byDesc = (start: string) => p.rows.find((r) => r.description?.startsWith(start));

  it("positivo é despesa e negativo é receita com valor positivo", () => {
    expect(byDesc("MERCADO TECH")).toMatchObject({ type: "expense", amountCents: 30000 });
    expect(byDesc("Pagamento recebido")).toMatchObject({ type: "income", amountCents: 50000 });
  });

  it("linha com R$ 0 some", () => {
    expect(p.rows.some((r) => r.description?.startsWith("LOJA ZERO"))).toBe(false);
    expect(p.rows).toHaveLength(7);
  });

  it("data em ISO, postedDate nulo, balances vazio", () => {
    expect(byDesc("MERCADO TECH")?.date).toBe("2026-09-12");
    expect(p.rows.every((r) => r.postedDate === null)).toBe(true);
    expect(p.balances).toEqual([]);
  });

  it("colapsa espaços da descrição", () => {
    expect(p.rows[0].description).toBe("CAFE CENTRAL");
  });

  it("compra em dólar ganha sufixo com US$ e cotação", () => {
    const r = byDesc("SERVICO STREAMING");
    expect(r?.description).toBe("SERVICO STREAMING (US$ 5.00 @ 5.44)");
    expect(r?.amountCents).toBe(2720);
  });

  it("linha de IOF (US$ 0) não ganha sufixo de dólar", () => {
    expect(byDesc("IOF")?.description).toBe("IOF COMPRA INTERNACIONAL");
  });

  it("parcelas viram sufixo n/m legível por parseInstallment; Única não tem sufixo", () => {
    const a = byDesc("LOJA MODA")!;
    expect(a.description).toBe("LOJA MODA CENTRO 3/10");
    expect(parseInstallment(a.description)).toEqual({ current: 3, total: 10 });
    const b = byDesc("MERCADO TECH")!;
    expect(b.description).toBe("MERCADO TECH 2/6");
    expect(parseInstallment(b.description)).toEqual({ current: 2, total: 6 });
    expect(byDesc("CAFE")?.description).toBe("CAFE CENTRAL");
  });

  it("bankCategory preenchida, e null quando '-'", () => {
    expect(byDesc("MERCADO TECH")?.bankCategory).toBe("Eletrônicos");
    expect(byDesc("Pagamento recebido")?.bankCategory).toBeNull();
  });

  it("period é a menor/maior data das linhas do cartão", () => {
    expect(p.period).toEqual({ from: "2026-09-05", to: "2026-09-15" });
    expect(parse("2222").period).toEqual({ from: "2026-09-06", to: "2026-09-11" });
  });

  it("aceita CRLF e BOM no parse", () => {
    expect(parse("1111", c6InvoiceText({ bom: true, crlf: true })).rows).toHaveLength(7);
  });

  it("aceita vírgula decimal e ponto decimal", () => {
    const rows = [
      `01/09/2026;${NAME};1111;-;COMPRA A;Única;0;0;1.234,56`,
      `01/09/2026;${NAME};1111;-;COMPRA B;Única;0;0;1234.56`,
    ];
    const q = c6CardInvoiceParser.parse(c6InvoiceText({ rows }), { accountId: "a" });
    expect(q.rows.map((r) => r.amountCents)).toEqual([123456, 123456]);
  });
});

describe("c6CardInvoiceParser.parse: fingerprints", () => {
  it("são únicos mesmo com linhas idênticas, com sufixo ordinal, e estáveis", () => {
    const a = parse("1111");
    const b = parse("1111");
    expect(a.rows.map((r) => r.fingerprint)).toEqual(b.rows.map((r) => r.fingerprint));
    expect(new Set(a.rows.map((r) => r.fingerprint)).size).toBe(a.rows.length);
    expect(a.rows[0].fingerprint.endsWith("|0")).toBe(true);
    expect(a.rows[1].fingerprint.endsWith("|1")).toBe(true);
  });

  it("trocar o accountId muda o fingerprint", () => {
    const a = parse("1111", c6InvoiceText(), "acc1");
    const b = parse("1111", c6InvoiceText(), "acc2");
    expect(a.rows[0].fingerprint).not.toBe(b.rows[0].fingerprint);
  });
});

describe("c6CardInvoiceParser.parse: erros sem conteúdo de linha", () => {
  const catchErr = (rows: string[]) => {
    try {
      c6CardInvoiceParser.parse(c6InvoiceText({ rows }), { accountId: "a" });
    } catch (e) {
      return e as Error;
    }
    return null;
  };

  it("data inválida cita só o número da linha", () => {
    const err = catchErr([`31/02/2026;${NAME};1111;-;SEGREDO COMERCIANTE;Única;0;0;10.00`]);
    expect(err).toBeInstanceOf(StatementParseError);
    expect(err?.message).toContain("2");
    expect(err?.message).not.toContain("SEGREDO");
    expect(err?.message).not.toContain("31/02/2026");
  });

  it("valor não numérico cita só o número da linha", () => {
    const err = catchErr([
      `01/09/2026;${NAME};1111;-;OK;Única;0;0;10.00`,
      `02/09/2026;${NAME};1111;-;SEGREDO COMERCIANTE;Única;0;0;abc`,
    ]);
    expect(err).toBeInstanceOf(StatementParseError);
    expect(err?.message).toContain("3");
    expect(err?.message).not.toContain("SEGREDO");
    expect(err?.message).not.toContain("abc");
  });

  it("linha com número de colunas errado não vaza conteúdo", () => {
    const err = catchErr([`01/09/2026;${NAME};1111;SEGREDO`]);
    expect(err).toBeInstanceOf(StatementParseError);
    expect(err?.message).not.toContain("SEGREDO");
  });

  it("cabeçalho sem coluna obrigatória cita o nome da coluna", () => {
    const text = C6_INVOICE_HEADER.replace("Descrição", "Texto") + "\n" + C6_INVOICE_ROWS[0] + "\n";
    // sem a coluna Descrição o arquivo deixa de ser reconhecido; o parse direto também falha
    expect(c6CardInvoiceParser.detect(text)).toBeNull();
    expect(() => c6CardInvoiceParser.parse(text, { accountId: "a" })).toThrow(StatementParseError);
  });
});
