import { describe, expect, it } from "vitest";
import { isPendingReview, type ReviewQueueRow } from "../review-queue";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const row = (over: Partial<ReviewQueueRow> = {}): ReviewQueueRow => ({
  type: "expense", ignored: false, transferPairId: null, reviewStatus: "ok", categoryId: "c1", categorySource: "manual",
  createdAt: minutesAgo(60), ...over,
});

describe("isPendingReview (espelha a fila Para categorizar)", () => {
  it("reviewStatus pending entra", () => {
    expect(isPendingReview(row({ reviewStatus: "pending", categoryId: null, categorySource: "none", createdAt: minutesAgo(1) }), NOW)).toBe(true);
  });

  it("categorizada e ok não entra", () => {
    expect(isPendingReview(row(), NOW)).toBe(false);
  });

  it("sem categoria, origem none e criada há mais de 15 min entra (linha esquecida), mesmo com status ok", () => {
    expect(isPendingReview(row({ categoryId: null, categorySource: "none", createdAt: minutesAgo(16) }), NOW)).toBe(true);
  });

  it("sem categoria criada há menos de 15 min não entra", () => {
    expect(isPendingReview(row({ categoryId: null, categorySource: "none", createdAt: minutesAgo(5) }), NOW)).toBe(false);
  });

  it("sem categoria mas com origem manual/regra/IA não é esquecida", () => {
    expect(isPendingReview(row({ categoryId: null, categorySource: "manual" }), NOW)).toBe(false);
  });

  it("pareadas, transferências e ignoradas nunca entram, mesmo pendentes", () => {
    const pending = { reviewStatus: "pending" as const, categoryId: null, categorySource: "none" };
    expect(isPendingReview(row({ ...pending, transferPairId: "p1" }), NOW)).toBe(false);
    expect(isPendingReview(row({ ...pending, type: "transfer" }), NOW)).toBe(false);
    expect(isPendingReview(row({ ...pending, ignored: true }), NOW)).toBe(false);
  });

  it("data inválida não vira esquecida", () => {
    expect(isPendingReview(row({ categoryId: null, categorySource: "none", createdAt: "x" }), NOW)).toBe(false);
  });
});
