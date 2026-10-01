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

  it("palavras inteiras: trechos dentro de outras palavras não casam", () => {
    expect(mapBankCategory("Automóveis")).toBeNull(); // contém "moveis"
    expect(mapBankCategory("Móveis e decoração")).toBe("Compras");
    expect(mapBankCategory("Radiologia")).toBeNull(); // contém "radio"
    expect(mapBankCategory("Serviços de rádio")).toBe("Assinaturas");
    expect(mapBankCategory("Comércio pela internet")).toBeNull(); // compra online não é conta de internet
    expect(mapBankCategory("Provedor de acesso à internet")).toBe("Contas e utilidades");
    expect(mapBankCategory("Recursos humanos")).toBeNull(); // contém "curso"
    expect(mapBankCategory("Cursos")).toBe("Educação");
    expect(mapBankCategory("Taxas governamentais")).toBe("Impostos e taxas");
    expect(mapBankCategory("Governo")).toBe("Impostos e taxas");
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
