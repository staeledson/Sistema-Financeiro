import { describe, it, expect } from "vitest";
import { redactForLlm } from "../redact";

describe("redactForLlm", () => {
  it("mascara CPF com e sem pontuação", () => {
    expect(redactForLlm("PIX JOAO 123.456.789-00")).toBe("PIX JOAO ###");
    expect(redactForLlm("PIX JOAO 12345678900")).toBe("PIX JOAO ###");
  });

  it("mascara CNPJ", () => {
    expect(redactForLlm("PAGTO 12.345.678/0001-95 LTDA")).toBe("PAGTO ### LTDA");
    expect(redactForLlm("12345678000195")).toBe("###");
  });

  it("mascara sequências longas de dígitos", () => {
    expect(redactForLlm("BOLETO 1234567890123")).toBe("BOLETO ###");
    expect(redactForLlm("TED 123456")).toBe("TED ###");
  });

  it("mantém textos com até 5 dígitos seguidos", () => {
    expect(redactForLlm("LOJA 12345")).toBe("LOJA 12345");
    expect(redactForLlm("COMPRA 03/10")).toBe("COMPRA 03/10");
    expect(redactForLlm("Supermercado Extra 123")).toBe("Supermercado Extra 123");
  });

  it("mascara documento colado em letras", () => {
    expect(redactForLlm("JOAO123.456.789-00")).toBe("JOAO###");
    expect(redactForLlm("CNPJ12.345.678/0001-95")).toBe("CNPJ###");
  });

  it("não mascara valores, datas e parcelas", () => {
    expect(redactForLlm("PAGTO 1.234.567,89")).toBe("PAGTO 1.234.567,89");
    expect(redactForLlm("COMPRA 01/10/2026")).toBe("COMPRA 01/10/2026");
    expect(redactForLlm("LOJA X 03/10")).toBe("LOJA X 03/10");
  });

  it("vazio ou nulo vira string vazia", () => {
    expect(redactForLlm("")).toBe("");
    expect(redactForLlm(null)).toBe("");
    expect(redactForLlm(undefined)).toBe("");
  });
});
