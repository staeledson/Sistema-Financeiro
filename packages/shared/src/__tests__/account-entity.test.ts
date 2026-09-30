import { describe, it, expect } from "vitest";
import {
  accountSchema,
  accountUpdateSchema,
  categorySchema,
  cardFieldsPresent,
  workspaceSettingsSchema,
  workspaceSettingsUpdateSchema,
  DEFAULT_WORKSPACE_SETTINGS,
} from "../index";

describe("accountSchema — entidade e instituição", () => {
  it("aplica os padrões entity=pf, institution=other e saldo 0", () => {
    const r = accountSchema.parse({ type: "checking", name: "Conta" });
    expect(r.entity).toBe("pf");
    expect(r.institution).toBe("other");
    expect(r.openingBalanceCents).toBe(0);
  });

  it("aceita cartão PJ do C6 com fechamento, vencimento e limite", () => {
    const r = accountSchema.parse({
      type: "credit_card",
      name: "C6 Empresa",
      entity: "pj",
      institution: "c6",
      externalId: "1234",
      closingDay: 10,
      dueDay: 17,
      creditLimitCents: 500000,
    });
    expect(r).toMatchObject({ entity: "pj", institution: "c6", closingDay: 10, dueDay: 17, creditLimitCents: 500000 });
  });

  it("rejeita dados de cartão em conta que não é cartão", () => {
    expect(() => accountSchema.parse({ type: "checking", name: "X", closingDay: 10 })).toThrow();
    expect(() => accountSchema.parse({ type: "savings", name: "X", creditLimitCents: 1000 })).toThrow();
  });

  it("aceita campos de cartão nulos em conta que não é cartão", () => {
    const r = accountSchema.parse({ type: "checking", name: "X", closingDay: null, dueDay: null, creditLimitCents: null });
    expect(r.closingDay).toBeNull();
  });

  it("rejeita dia de fechamento ou vencimento fora de 1–31", () => {
    const base = { type: "credit_card", name: "Cartão" };
    expect(() => accountSchema.parse({ ...base, closingDay: 0 })).toThrow();
    expect(() => accountSchema.parse({ ...base, closingDay: 32 })).toThrow();
    expect(() => accountSchema.parse({ ...base, dueDay: 40 })).toThrow();
  });

  it("rejeita entidade e instituição inválidas", () => {
    expect(() => accountSchema.parse({ type: "checking", name: "X", entity: "xx" })).toThrow();
    expect(() => accountSchema.parse({ type: "checking", name: "X", institution: "nubank" })).toThrow();
  });
});

describe("accountUpdateSchema", () => {
  it("aceita atualização parcial", () => {
    expect(accountUpdateSchema.parse({ entity: "pj" })).toEqual({ entity: "pj" });
    expect(accountUpdateSchema.parse({})).toEqual({});
  });

  it("rejeita entidade inválida e nome vazio", () => {
    expect(() => accountUpdateSchema.parse({ entity: "xx" })).toThrow();
    expect(() => accountUpdateSchema.parse({ name: "" })).toThrow();
  });

  it("permite limpar o externalId com null", () => {
    expect(accountUpdateSchema.parse({ externalId: null })).toEqual({ externalId: null });
  });
});

describe("cardFieldsPresent", () => {
  it("detecta qualquer campo de cartão preenchido", () => {
    expect(cardFieldsPresent({})).toBe(false);
    expect(cardFieldsPresent({ closingDay: null, dueDay: null })).toBe(false);
    expect(cardFieldsPresent({ dueDay: 5 })).toBe(true);
    expect(cardFieldsPresent({ creditLimitCents: 0 })).toBe(true);
  });
});

describe("categorySchema — entity", () => {
  it("usa both como padrão e aceita pf e pj", () => {
    expect(categorySchema.parse({ type: "expense", name: "X" }).entity).toBe("both");
    expect(categorySchema.parse({ type: "expense", name: "X", entity: "pj" }).entity).toBe("pj");
  });

  it("rejeita entity inválida", () => {
    expect(() => categorySchema.parse({ type: "expense", name: "X", entity: "xx" })).toThrow();
  });

  it("partial() não reaplica o padrão both em atualizações", () => {
    expect(categorySchema.partial().parse({ name: "Novo" })).toEqual({ name: "Novo" });
  });
});

describe("workspaceSettingsSchema", () => {
  it("expõe os padrões da spec", () => {
    expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({
      aiConfidenceThreshold: 0.8,
      aiBatchSize: 40,
      transferMatchWindowDays: 2,
      ownerNames: [],
    });
    expect(workspaceSettingsSchema.parse(DEFAULT_WORKSPACE_SETTINGS)).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("rejeita limiar fora de 0–1, lote inválido e janela negativa", () => {
    expect(() => workspaceSettingsUpdateSchema.parse({ aiConfidenceThreshold: 1.5 })).toThrow();
    expect(() => workspaceSettingsUpdateSchema.parse({ aiBatchSize: 0 })).toThrow();
    expect(() => workspaceSettingsUpdateSchema.parse({ transferMatchWindowDays: -1 })).toThrow();
  });

  it("apara os nomes do titular e rejeita nome vazio", () => {
    expect(workspaceSettingsUpdateSchema.parse({ ownerNames: ["  Stael Edson  "] })).toEqual({ ownerNames: ["Stael Edson"] });
    expect(() => workspaceSettingsUpdateSchema.parse({ ownerNames: ["   "] })).toThrow();
  });
});
