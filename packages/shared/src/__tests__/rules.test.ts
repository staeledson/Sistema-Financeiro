import { describe, it, expect } from "vitest";
import { applyRules, ruleFromCorrection } from "../rules";

const rules = [
  { matchType: "contains" as const, pattern: "ifood", categoryId: "c-rest", priority: 100 },
  { matchType: "equals" as const, pattern: "uber", categoryId: "c-transp", priority: 90 },
];

describe("applyRules", () => {
  it("casa por contains (case-insensitive)", () => {
    expect(applyRules("Compra IFOOD SP", rules)).toBe("c-rest");
  });
  it("respeita prioridade — equals sobre contains quando ambos casam", () => {
    const both = [
      { matchType: "contains" as const, pattern: "uber", categoryId: "c-cont", priority: 90 },
      { matchType: "equals" as const, pattern: "uber", categoryId: "c-transp", priority: 95 },
    ];
    expect(applyRules("uber", both)).toBe("c-transp");
  });
  it("equals não casa substring", () => {
    expect(applyRules("ubereats", rules)).toBeNull();
  });
  it("sem match → null", () => {
    expect(applyRules("posto shell", rules)).toBeNull();
  });
  it("regex funciona", () => {
    const r = [{ matchType: "regex" as const, pattern: "^netflix", categoryId: "c-assin", priority: 100 }];
    expect(applyRules("Netflix.com pagamento", r)).toBe("c-assin");
    expect(applyRules("pagar netflix", r)).toBeNull();
  });
});

describe("ruleFromCorrection", () => {
  it("deriva contains do fornecedor", () => {
    const r = ruleFromCorrection({ counterparty: "Netflix.com", description: null }, "c-assin");
    expect(r.matchType).toBe("contains");
    expect(r.pattern).toBe("netflix.com");
    expect(r.categoryId).toBe("c-assin");
    expect(r.priority).toBe(120);
  });
  it("cai para description se não há counterparty", () => {
    const r = ruleFromCorrection({ counterparty: null, description: "IFOOD SP 123" }, "c-rest");
    expect(r.pattern).toBe("ifood sp 123");
  });
  it("trunca em 3 palavras", () => {
    const r = ruleFromCorrection({ counterparty: "Mercado Livre Extra Longa Descricao" }, "c-merc");
    expect(r.pattern).toBe("mercado livre extra");
  });
});
