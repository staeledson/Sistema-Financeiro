import { describe, expect, it } from "vitest";
import { formatBRL, formatBRLCompact, signedClass } from "../money";

describe("money", () => {
  it("formatBRL formata em reais com separadores pt-BR", () => {
    expect(formatBRL(123456)).toContain("1.234,56");
    expect(formatBRL(123456)).toContain("R$");
  });

  it("formatBRL de valor negativo traz sinal", () => {
    const s = formatBRL(-5);
    expect(s).toContain("-");
    expect(s).toContain("0,05");
  });

  it("formatBRLCompact usa mil e mi", () => {
    expect(formatBRLCompact(120_000_00)).toBe("R$ 120 mil");
    expect(formatBRLCompact(2_500_000_00)).toBe("R$ 2,5 mi");
    expect(formatBRLCompact(-120_000_00)).toBe("-R$ 120 mil");
  });

  it("formatBRLCompact abaixo de mil cai no formato completo", () => {
    expect(formatBRLCompact(99_999)).toBe(formatBRL(99_999));
  });

  it("signedClass", () => {
    expect(signedClass(5)).toBe("pos");
    expect(signedClass(-5)).toBe("neg");
    expect(signedClass(0)).toBe("zero");
  });
});
