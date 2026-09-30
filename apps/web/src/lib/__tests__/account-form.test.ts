import { describe, it, expect } from "vitest";
import {
  emptyAccountForm,
  formFromAccount,
  buildCreateAccountPayload,
  buildUpdateAccountPayload,
} from "../account-form";
import type { BankAccount } from "../api";

describe("buildCreateAccountPayload", () => {
  it("conta corrente: converte reais em centavos e omite dados de cartão", () => {
    const f = { ...emptyAccountForm(), name: "  Inter PF  ", entity: "pf" as const, institution: "inter" as const, openingBalanceReais: 10.5, closingDay: 10, dueDay: 17, creditLimitReais: 500 };
    expect(buildCreateAccountPayload(f)).toEqual({
      type: "checking", name: "Inter PF", openingBalanceCents: 1050,
      entity: "pf", institution: "inter", externalId: null,
    });
  });

  it("cartão: inclui fechamento, vencimento e limite em centavos", () => {
    const f = { ...emptyAccountForm(), type: "credit_card" as const, name: "C6 Empresa", entity: "pj" as const, institution: "c6" as const, externalId: " 1234 ", closingDay: 10, dueDay: 17, creditLimitReais: 5000.5 };
    expect(buildCreateAccountPayload(f)).toMatchObject({
      type: "credit_card", entity: "pj", institution: "c6", externalId: "1234",
      closingDay: 10, dueDay: 17, creditLimitCents: 500050,
    });
  });

  it("cartão: campos numéricos vazios (string vazia do input) viram null", () => {
    const f = { ...emptyAccountForm(), type: "credit_card" as const, name: "Cartão", closingDay: "" as unknown as number, dueDay: null, creditLimitReais: "" as unknown as number };
    expect(buildCreateAccountPayload(f)).toMatchObject({ closingDay: null, dueDay: null, creditLimitCents: null });
  });
});

describe("buildUpdateAccountPayload", () => {
  it("não envia tipo nem saldo inicial", () => {
    const f = { ...emptyAccountForm(), name: "Conta", entity: "pj" as const, institution: "bb" as const };
    const p = buildUpdateAccountPayload(f);
    expect(p).toEqual({ name: "Conta", entity: "pj", institution: "bb", externalId: null });
    expect(p).not.toHaveProperty("type");
    expect(p).not.toHaveProperty("openingBalanceCents");
  });

  it("cartão envia os três campos de cartão", () => {
    const f = { ...emptyAccountForm(), type: "credit_card" as const, name: "C", closingDay: 5, dueDay: 12, creditLimitReais: 100 };
    expect(buildUpdateAccountPayload(f)).toMatchObject({ closingDay: 5, dueDay: 12, creditLimitCents: 10000 });
  });
});

describe("formFromAccount", () => {
  it("converte centavos em reais e trata nulos", () => {
    const acc: BankAccount = {
      id: "1", type: "credit_card", name: "Cartão", openingBalanceCents: 0, archived: false,
      entity: "pj", institution: "c6", externalId: null, closingDay: 10, dueDay: 17, creditLimitCents: 500050,
    };
    expect(formFromAccount(acc)).toMatchObject({
      type: "credit_card", name: "Cartão", entity: "pj", institution: "c6", externalId: "",
      closingDay: 10, dueDay: 17, creditLimitReais: 5000.5,
    });
  });
});
