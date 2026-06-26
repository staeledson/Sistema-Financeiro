import { describe, it, expect } from "vitest";
import { parseOfx } from "../ofx";

const OFX_SAMPLE = `
OFXHEADER:100
DATA:OFXSGML

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260605
<TRNAMT>-35.00
<FITID>2026060500001
<MEMO>iFood Pagamento
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260610
<TRNAMT>5000.00
<FITID>2026061000001
<NAME>Salário
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

describe("parseOfx", () => {
  it("extrai 2 transações do OFX", () => {
    const txs = parseOfx(OFX_SAMPLE);
    expect(txs).toHaveLength(2);
  });

  it("extrai FITID corretamente", () => {
    const txs = parseOfx(OFX_SAMPLE);
    expect(txs[0].fitid).toBe("2026060500001");
    expect(txs[1].fitid).toBe("2026061000001");
  });

  it("converte DTPOSTED para dateISO", () => {
    const txs = parseOfx(OFX_SAMPLE);
    expect(txs[0].dateISO).toBe("2026-06-05");
    expect(txs[1].dateISO).toBe("2026-06-10");
  });

  it("converte TRNAMT para centavos (preserva sinal)", () => {
    const txs = parseOfx(OFX_SAMPLE);
    expect(txs[0].amountCents).toBe(-3500);
    expect(txs[1].amountCents).toBe(500000);
  });

  it("extrai MEMO ou NAME", () => {
    const txs = parseOfx(OFX_SAMPLE);
    expect(txs[0].memo).toBe("iFood Pagamento");
    expect(txs[1].memo).toBe("Salário");
  });
});
