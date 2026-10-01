import { describe, expect, it } from "vitest";
import { formatAdjustment, parseMoneyInput } from "../money-input";

describe("parseMoneyInput", () => {
  it.each([
    ["16,59", 1659],
    ["16.59", 1659],
    ["6.508,80", 650880],
    ["1.234,56", 123456],
    ["1.234.567,89", 123456789],
    ["1,234.56", 123456],
    ["1,234,567.89", 123456789],
    ["1234.56", 123456],
    ["1234,56", 123456],
    ["0,05", 5],
    ["0", 0],
    ["120", 12000],
    ["16,5", 1650],
    ["16.5", 1650],
    ["-120,5", -12050],
    ["+120,5", 12050],
    ["−120,50", -12050], // sinal de menos tipográfico
    ["R$ 1.234,56", 123456],
    ["-R$ 1.234,56", -123456],
    ["R$ -16,59", -1659],
    ["  16,59  ", 1659],
    ["1.234", 123400], // ponto com grupos de 3 dígitos = milhar (pt-BR)
    ["1.234.567", 123456700],
    ["1 234,56", 123456],
  ])("aceita %j -> %d centavos", (text, cents) => {
    expect(parseMoneyInput(text)).toBe(cents);
  });

  it("zero negativo vira 0 (nunca -0)", () => {
    expect(Object.is(parseMoneyInput("-0,00"), 0)).toBe(true);
    expect(Object.is(parseMoneyInput("-0"), 0)).toBe(true);
  });

  it.each([
    "", "   ", "-", "+", "R$", "abc", "12a", "1,2,3", "16,", ",50", ".50", "-,5",
    "16,599", // mais de 2 casas decimais
    "16.599,1.2", "0.123", "1,234", "1.23.456", "12.3456", "1.2345,67", "1,23,456.78", "1.234,5,6", "--5", "5-", "1e3", "∞", "NaN",
    "99999999999999999", // além do inteiro seguro em centavos
  ])("rejeita %j", (text) => {
    expect(parseMoneyInput(text)).toBeNull();
  });
});

describe("formatAdjustment", () => {
  const plain = (s: string) => s.replace(/ /g, " ");
  it("positivo, negativo e zero", () => {
    expect(plain(formatAdjustment(358))).toBe("+R$ 3,58");
    expect(plain(formatAdjustment(-6341))).toBe("−R$ 63,41");
    expect(plain(formatAdjustment(0))).toBe("R$ 0,00 (sem ajuste)");
  });
});
