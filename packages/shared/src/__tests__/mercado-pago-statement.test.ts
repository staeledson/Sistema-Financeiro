import { describe, it, expect } from "vitest";
import {
  STATEMENT_PARSERS,
  StatementParseError,
  c6StatementParser,
  detectStatement,
  mercadoPagoStatementParser,
  ofxStatementParser,
  c6CardInvoiceParser,
  verifyBalances,
} from "../index";
import { MP_DESCRIPTIONS, MP_RECORDS, MP_SAMPLE, mercadoPagoSampleText } from "../parsers/__fixtures__/mercado-pago-sample";
import { c6SampleText } from "../parsers/__fixtures__/c6-sample";
import { c6InvoiceText } from "../parsers/__fixtures__/c6-invoice-sample";

const OFX = "OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>077<ACCTID>555-1</BANKACCTFROM></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

function parseError(text: string): StatementParseError {
  try {
    mercadoPagoStatementParser.parse(text, { accountId: "acc1" });
  } catch (e) {
    expect(e).toBeInstanceOf(StatementParseError);
    return e as StatementParseError;
  }
  throw new Error("esperava StatementParseError");
}

describe("mercadoPagoStatementParser.detect", () => {
  it("reconhece o extrato, com confiança alta e a conta só em dígitos", () => {
    expect(mercadoPagoStatementParser.detect(mercadoPagoSampleText())).toEqual({
      institution: "mercado_pago", kind: "statement", format: "pdf_statement", accountRef: MP_SAMPLE.conta, confidence: 0.95,
    });
  });

  it("a conta é o último número antes de 'Agência:' (rótulos vêm depois dos valores)", () => {
    expect(mercadoPagoStatementParser.detect(mercadoPagoSampleText({ conta: "99887766554" }))?.accountRef).toBe("99887766554");
  });

  it("está registrado e o detectStatement escolhe ele", () => {
    expect(STATEMENT_PARSERS).toContain(mercadoPagoStatementParser);
    const hit = detectStatement(mercadoPagoSampleText());
    expect(hit?.parser.id).toBe("mercado_pago");
    expect(hit?.detected.institution).toBe("mercado_pago");
  });

  it("não dispara em extrato do C6, OFX, fatura CSV do C6 nem texto qualquer", () => {
    expect(mercadoPagoStatementParser.detect(c6SampleText())).toBeNull();
    expect(mercadoPagoStatementParser.detect(OFX)).toBeNull();
    expect(mercadoPagoStatementParser.detect(c6InvoiceText())).toBeNull();
    expect(mercadoPagoStatementParser.detect("Compra Netflix 15/06/2026 R$ 55,90")).toBeNull();
  });

  it("os outros parsers não disparam no extrato do Mercado Pago", () => {
    const t = mercadoPagoSampleText();
    expect(c6StatementParser.detect(t)).toBeNull();
    expect(ofxStatementParser.detect(t)).toBeNull();
    expect(c6CardInvoiceParser.detect(t)).toBeNull();
  });

  it("exige o cabeçalho de colunas e os saldos", () => {
    const t = mercadoPagoSampleText();
    expect(mercadoPagoStatementParser.detect(t.replaceAll("Data Descrição ID da operação Valor Saldo", "Data Descrição"))).toBeNull();
    expect(mercadoPagoStatementParser.detect(t.replace("DETALHE DOS MOVIMENTOS", ""))).toBeNull();
    expect(mercadoPagoStatementParser.detect(t.replace(/Saldo final:.*\n/, ""))).toBeNull();
  });
});

describe("mercadoPagoStatementParser.parse", () => {
  const parsed = mercadoPagoStatementParser.parse(mercadoPagoSampleText(), { accountId: "acc1" });

  it("tem pelo menos 25 registros de teste e lê todos", () => {
    expect(MP_RECORDS.length).toBeGreaterThanOrEqual(25);
    expect(parsed.rows).toHaveLength(MP_SAMPLE.rowCount);
  });

  it("tipo, valor positivo e data de cada registro, na ordem do arquivo", () => {
    parsed.rows.forEach((row, i) => {
      const rec = MP_RECORDS[i];
      const [d, m, y] = rec.date.split("-");
      expect(row.type).toBe(rec.cents < 0 ? "expense" : "income");
      expect(row.amountCents).toBe(Math.abs(rec.cents));
      expect(row.date).toBe(`${y}-${m}-${d}`);
      expect(row.postedDate).toBeNull();
    });
  });

  it("descrição: linhas na ordem do texto, espaços colapsados, sem o id da operação", () => {
    parsed.rows.forEach((row, i) => {
      expect(row.description).toBe(MP_DESCRIPTIONS[i]);
      expect(row.description).not.toContain(MP_RECORDS[i].opId);
    });
    // registro de uma linha só
    expect(parsed.rows[0].description).toBe("Rendimentos");
    // quebrada em duas linhas
    expect(parsed.rows[1].description).toBe("Pix recebido ANA TESTE DA SILVA EXEMPLO");
    // data sozinha na linha; o número solto da descrição não é confundido com o id
    expect(parsed.rows[2].description).toBe("Pix enviado Carlos Ficticio Santos Modelo 60348001371");
    // ordem das linhas preservada como extraída
    expect(parsed.rows[5].description).toBe("Liberação de dinheiro Venda com Pix");
  });

  it("registro partido pela quebra de página junta o fim da página 1 com o topo da 2, sem o rodapé", () => {
    const split = parsed.rows[10];
    expect(split.description).toBe("Reserva por gastos Reserva Emergência");
    expect(split).toMatchObject({ type: "expense", amountCents: 350, date: "2026-09-06" });
  });

  it("valores: centavos de rendimento e milhares positivos e negativos", () => {
    expect(parsed.rows[3]).toMatchObject({ type: "income", amountCents: 1 });
    expect(parsed.rows[1]).toMatchObject({ type: "income", amountCents: 120000 });
    expect(parsed.rows[4]).toMatchObject({ type: "expense", amountCents: 100000 });
  });

  it("lixo de página (marcas, cabeçalho repetido, rodapé, Saldo final) nunca entra em descrição", () => {
    for (const r of parsed.rows) {
      expect(r.description).not.toMatch(/Saldo final|Data Descrição|-- \d of|Data de geração|^\d+\/\d+$|CNPJ/);
    }
  });

  it("lê período, conta e saldos (âncora no dia anterior + saldo após o último registro de cada data)", () => {
    expect(parsed.period).toEqual(MP_SAMPLE.period);
    expect(parsed.accountRef).toBe(MP_SAMPLE.conta);
    expect(parsed.balances[0]).toEqual({ dateISO: "2026-08-31", balanceCents: MP_SAMPLE.initialCents });
    const dates = new Set(parsed.rows.map((r) => r.date));
    expect(parsed.balances).toHaveLength(dates.size + 1);
    expect(parsed.balances.at(-1)).toEqual({ dateISO: "2026-09-30", balanceCents: MP_SAMPLE.finalCents });
    // 03-09: o saldo é o do ÚLTIMO registro do dia (liberação + cancelamento voltam ao mesmo saldo)
    const day3 = parsed.balances.find((b) => b.dateISO === "2026-09-03");
    const before = parsed.balances.find((b) => b.dateISO === "2026-09-02");
    expect(day3?.balanceCents).toBe(before?.balanceCents);
  });

  it("fingerprints únicos, estáveis entre leituras e dependentes da conta", () => {
    const fps = parsed.rows.map((r) => r.fingerprint);
    expect(new Set(fps).size).toBe(fps.length);
    const again = mercadoPagoStatementParser.parse(mercadoPagoSampleText(), { accountId: "acc1" });
    expect(again.rows.map((r) => r.fingerprint)).toEqual(fps);
    const other = mercadoPagoStatementParser.parse(mercadoPagoSampleText(), { accountId: "acc2" });
    expect(other.rows.every((r, i) => r.fingerprint !== fps[i])).toBe(true);
    expect(fps[0]).toBe("mp:acc1:1749235379376:3|0");
  });

  it("mesmo id de operação com sinais opostos: dois registros, fingerprints distintos", () => {
    const [release, cancel] = [parsed.rows[5], parsed.rows[6]];
    expect(MP_RECORDS[5].opId).toBe(MP_RECORDS[6].opId);
    expect(release.type).toBe("income");
    expect(cancel.type).toBe("expense");
    expect(release.fingerprint).not.toBe(cancel.fingerprint);
  });

  it("registros idênticos (mesmo id e valor) ganham ordinal", () => {
    const [a, b] = [parsed.rows[8], parsed.rows[9]];
    expect(a.fingerprint).toBe("mp:acc1:176100000002:-990|0");
    expect(b.fingerprint).toBe("mp:acc1:176100000002:-990|1");
  });

  it("verifyBalances fecha em todos os pontos", () => {
    const check = verifyBalances(parsed.rows, parsed.balances);
    expect(check?.ok).toBe(true);
    expect(check?.mismatches).toEqual([]);
    expect(check?.checkpoints).toBe(parsed.balances.length - 1);
  });

  it("um valor adulterado depois da leitura aparece como divergência", () => {
    const rows = parsed.rows.map((r, i) => (i === 12 ? { ...r, amountCents: r.amountCents + 100 } : r));
    const check = verifyBalances(rows, parsed.balances);
    expect(check?.ok).toBe(false);
    expect(check?.mismatches[0]).toMatchObject({ dateISO: "2026-09-07", diffCents: -100 });
  });

  it("reimportar o texto com CRLF e espaços extras lê o mesmo", () => {
    const text = mercadoPagoSampleText().replace(/\n/g, "  \r\n");
    const p = mercadoPagoStatementParser.parse(text, { accountId: "acc1" });
    expect(p.rows).toEqual(parsed.rows);
  });
});

describe("mercadoPagoStatementParser.parse: validações (StatementParseError sem conteúdo do extrato)", () => {
  it("total de entradas diferente do cabeçalho", () => {
    const e = parseError(mercadoPagoSampleText({ incomesDelta: 1 }));
    expect(e.message).toBe("total de entradas não confere com o cabeçalho");
  });

  it("total de saídas diferente do cabeçalho", () => {
    const e = parseError(mercadoPagoSampleText({ outgoingsDelta: -1 }));
    expect(e.message).toBe("total de saídas não confere com o cabeçalho");
  });

  it("valor adulterado quebra a continuidade do saldo e cita só o número do registro", () => {
    const e = parseError(mercadoPagoSampleText({ valueDelta: { record: 13, cents: 500 } }));
    expect(e.message).toBe("saldo do registro 13 não confere");
  });

  it("saldo corrente adulterado quebra a continuidade", () => {
    const e = parseError(mercadoPagoSampleText({ balanceDelta: { record: 4, cents: 1 } }));
    expect(e.message).toBe("saldo do registro 4 não confere");
  });

  it("Saldo final diferente do último registro", () => {
    const e = parseError(mercadoPagoSampleText({ finalDelta: 1 }));
    expect(e.message).toBe("saldo final não confere com o último registro");
  });

  it("registro sem a linha de fechamento", () => {
    const t = mercadoPagoSampleText();
    const broken = t.replace("01-09-2026 Rendimentos 1749235379376 R$ 0,03 R$ 1.500,03", "01-09-2026 Rendimentos");
    expect(broken).not.toBe(t);
    expect(parseError(broken).message).toBe("registro 1 incompleto");
  });

  it("sem período, sem cabeçalho de totais ou sem registros", () => {
    expect(parseError(mercadoPagoSampleText().replace(/De \S+ al \S+/, "")).message).toBe("período do extrato ausente ou inválido");
    expect(parseError(mercadoPagoSampleText().replace(/Saidas:.*\n/, "")).message).toBe("saldo inicial ou totais do cabeçalho ausentes");
    const noRows = ["EXTRATO DE CONTA", "De 01-09-2026 al 30-09-2026", "Saldo inicial: R$ 1,00 Entradas: R$ 0,00", "Saidas: R$ 0,00", "DETALHE DOS MOVIMENTOS"].join("\n");
    expect(parseError(noRows).message).toBe("nenhum lançamento encontrado no extrato");
  });

  it("data inexistente no calendário", () => {
    const e = parseError(mercadoPagoSampleText().replace("07-09-2026 Rendimentos", "31-02-2026 Rendimentos"));
    expect(e.message).toBe("registro 12: data inválida");
  });

  it("nenhuma mensagem de erro carrega descrição, id ou valor do extrato", () => {
    const variants = [
      mercadoPagoSampleText({ incomesDelta: 1 }),
      mercadoPagoSampleText({ outgoingsDelta: -1 }),
      mercadoPagoSampleText({ valueDelta: { record: 3, cents: 7 } }),
      mercadoPagoSampleText({ balanceDelta: { record: 20, cents: 7 } }),
      mercadoPagoSampleText({ finalDelta: 5 }),
      mercadoPagoSampleText().replace("07-09-2026 Rendimentos", "31-02-2026 Rendimentos"),
    ];
    for (const text of variants) {
      const msg = parseError(text).message;
      for (const r of MP_RECORDS) {
        expect(msg).not.toContain(r.opId);
        expect(msg).not.toContain(r.lines[0]);
      }
      expect(msg).not.toMatch(/R\$|\d{9,}|TITULAR|FICTICIO/);
    }
  });
});
