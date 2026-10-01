import { describe, expect, it } from "vitest";
import { futureActivity } from "../reconcile";
import { localTodayISO } from "../date";

const t = (over: Record<string, unknown>) => ({ type: "expense", amountCents: 100, date: "2026-10-05", accountId: "a1", sourceAccountId: null, destAccountId: null, ...over }) as Parameters<typeof futureActivity>[0][number];

describe("futureActivity", () => {
  it("conta e soma só os lançamentos da conta com data depois de hoje", () => {
    const list = [
      t({ type: "income", amountCents: 1000, date: "2026-10-05T00:00:00.000Z" }),
      t({ amountCents: 300, date: "2026-11-01" }),
      t({ type: "transfer", amountCents: 50, accountId: null, sourceAccountId: "a1", destAccountId: "a2", date: "2026-10-09" }),
      t({ type: "transfer", amountCents: 70, accountId: null, sourceAccountId: "a2", destAccountId: "a1", date: "2026-10-09" }),
      t({ date: "2026-10-01" }), // passado
      t({ date: "2026-10-02" }), // hoje
      t({ accountId: "a2", date: "2026-12-01" }), // outra conta
    ];
    expect(futureActivity(list, "a1", "2026-10-02")).toEqual({ count: 4, netCents: 1000 - 300 - 50 + 70 });
  });
  it("lista vazia ou sem futuros", () => {
    expect(futureActivity([], "a1", "2026-10-02")).toEqual({ count: 0, netCents: 0 });
    expect(futureActivity([t({ date: "2026-10-02" })], "a1", "2026-10-02")).toEqual({ count: 0, netCents: 0 });
  });
});

describe("localTodayISO", () => {
  it("usa o dia local, não UTC", () => {
    expect(localTodayISO(new Date(2026, 9, 2, 23, 30))).toBe("2026-10-02");
    expect(localTodayISO(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });
});
