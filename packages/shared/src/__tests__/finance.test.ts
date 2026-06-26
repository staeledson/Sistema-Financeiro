import { describe, it, expect } from "vitest";
import { transactionInputSchema, ACCOUNT_TYPES } from "../index";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

describe("finance schemas", () => {
  it("expõe account types", () => {
    expect(ACCOUNT_TYPES).toContain("credit_card");
  });
  it("aceita despesa válida", () => {
    expect(transactionInputSchema.safeParse({
      type: "expense", amountCents: 3500, date: "2026-06-01",
      accountId: A, categoryId: B,
    }).success).toBe(true);
  });
  it("rejeita transfer com categoria", () => {
    expect(transactionInputSchema.safeParse({
      type: "transfer", amountCents: 1000, date: "2026-06-01",
      sourceAccountId: A, destAccountId: B, categoryId: C,
    }).success).toBe(false);
  });
  it("rejeita transfer com origem=destino", () => {
    expect(transactionInputSchema.safeParse({
      type: "transfer", amountCents: 1000, date: "2026-06-01",
      sourceAccountId: A, destAccountId: A,
    }).success).toBe(false);
  });
  it("rejeita amount <= 0", () => {
    expect(transactionInputSchema.safeParse({
      type: "income", amountCents: 0, date: "2026-06-01", accountId: A,
    }).success).toBe(false);
  });
});
