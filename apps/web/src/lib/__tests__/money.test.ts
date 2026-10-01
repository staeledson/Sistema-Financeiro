import { describe, expect, it } from "vitest";
import { formatBRL, formatBRLCompact, signedClass } from "../money";

const NBSP = " ";
/** Compara ignorando a diferença entre espaço comum e não separável. */
const plain = (s: string) => s.replace(/ /g, " ");

describe("money", () => {
  it("formatBRL formata em reais com separadores pt-BR", () => {
    expect(plain(formatBRL(123456))).toBe("R$ 1.234,56");
  });

  it("formatBRL usa espaço não separável entre R$ e o número", () => {
    expect(formatBRL(123456)).toBe(`R$${NBSP}1.234,56`);
    expect(formatBRL(-5)).toBe(`-R$${NBSP}0,05`);
    expect(formatBRL(123456)).not.toContain(" ");
  });

  it("formatBRL de valor negativo traz sinal", () => {
    const s = formatBRL(-5);
    expect(s).toContain("-");
    expect(s).toContain("0,05");
  });

  it("formatBRL normaliza -0 (e fração que arredonda a zero) para R$ 0,00", () => {
    expect(plain(formatBRL(-0))).toBe("R$ 0,00");
    expect(plain(formatBRL(-0.4))).toBe("R$ 0,00");
    expect(plain(formatBRL(0))).toBe("R$ 0,00");
  });

  it("formatBRLCompact usa mil e mi", () => {
    expect(plain(formatBRLCompact(120_000_00))).toBe("R$ 120 mil");
    expect(plain(formatBRLCompact(2_500_000_00))).toBe("R$ 2,5 mi");
    expect(plain(formatBRLCompact(-120_000_00))).toBe("-R$ 120 mil");
  });

  it("formatBRLCompact mantém espaço não separável entre R$ e o número", () => {
    expect(formatBRLCompact(120_000_00)).toBe(`R$${NBSP}120 mil`);
  });

  it("formatBRLCompact arredonda antes de escolher a unidade", () => {
    expect(plain(formatBRLCompact(99_995_000))).toBe("R$ 1 mi");
    expect(plain(formatBRLCompact(-99_995_000))).toBe("-R$ 1 mi");
    expect(plain(formatBRLCompact(99_949_999))).toBe("R$ 999,5 mil");
  });

  it("formatBRLCompact abaixo de mil cai no formato completo", () => {
    expect(formatBRLCompact(99_999)).toBe(formatBRL(99_999));
    expect(plain(formatBRLCompact(-0))).toBe("R$ 0,00");
  });

  it("signedClass", () => {
    expect(signedClass(5)).toBe("pos");
    expect(signedClass(-5)).toBe("neg");
    expect(signedClass(0)).toBe("zero");
  });
});
