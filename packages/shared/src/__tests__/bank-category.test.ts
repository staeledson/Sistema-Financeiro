import { describe, it, expect } from "vitest";
import { mapBankCategory } from "../parsers/bank-category";

describe("mapBankCategory", () => {
  const table: Array<[string, string]> = [
    ["Restaurante / Lanchonete / Bar", "Restaurantes e delivery"],
    ["Supermercados / Mercearias", "Supermercado"],
    ["Assistência médica e odontológica", "Saúde"],
    ["Farmácias e drogarias", "Farmácia"],
    ["Serviços de telecomunicações", "Contas e utilidades"],
    ["TV por assinatura / Serviços de rádio", "Assinaturas"],
    ["Educacional", "Educação"],
    ["Combustível", "Combustível"],
    ["Postos de gasolina", "Combustível"],
    ["Táxi / Transporte", "Transporte"],
    ["Pedágio", "Transporte"],
    ["Estacionamento", "Transporte"],
    ["Vestuário", "Compras"],
    ["Lojas de departamento", "Compras"],
    ["Eletrônicos", "Compras"],
    ["Entretenimento", "Lazer"],
    ["Cinema", "Lazer"],
    ["Hotéis", "Lazer"],
    ["Companhias aéreas", "Lazer"],
    ["Agências de viagem", "Lazer"],
    ["Veterinário", "Pets"],
    ["Pet shop", "Pets"],
    ["Impostos", "Impostos e taxas"],
  ];

  it.each(table)("%s -> %s", (bank, ours) => {
    expect(mapBankCategory(bank)).toBe(ours);
  });

  it("ignora caixa e acento", () => {
    expect(mapBankCategory("FARMACIAS E DROGARIAS")).toBe("Farmácia");
    expect(mapBankCategory("vestuario")).toBe("Compras");
  });

  it("Elétrico é código de comerciante, não conta de luz", () => {
    expect(mapBankCategory("Elétrico")).toBeNull();
  });

  it("vazio, hífen, null e desconhecida dão null", () => {
    expect(mapBankCategory("-")).toBeNull();
    expect(mapBankCategory("")).toBeNull();
    expect(mapBankCategory("   ")).toBeNull();
    expect(mapBankCategory(null)).toBeNull();
    expect(mapBankCategory(undefined)).toBeNull();
    expect(mapBankCategory("Categoria Inexistente XYZ")).toBeNull();
  });
});
