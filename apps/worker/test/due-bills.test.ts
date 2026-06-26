import { describe, it, expect } from "vitest";
import { dueBills, type BillLike } from "../src/reminders/due-bills";

function bill(id: string, dueDate: Date): BillLike {
  return { id, name: `Bill ${id}`, amountCents: 10000n, dueDate, workspaceId: "ws1" };
}

describe("dueBills()", () => {
  const today = new Date("2026-06-26");

  it("includes a bill due exactly today", () => {
    const bills = [bill("a", new Date("2026-06-26"))];
    expect(dueBills(bills, today)).toHaveLength(1);
  });

  it("includes a bill due within the window", () => {
    const bills = [bill("b", new Date("2026-06-28"))];
    expect(dueBills(bills, today)).toHaveLength(1);
  });

  it("includes a bill due on the last day of the window", () => {
    const bills = [bill("c", new Date("2026-06-29"))]; // today + 3
    expect(dueBills(bills, today)).toHaveLength(1);
  });

  it("excludes a bill due after the window", () => {
    const bills = [bill("d", new Date("2026-06-30"))]; // today + 4
    expect(dueBills(bills, today)).toHaveLength(0);
  });

  it("excludes a bill due before today", () => {
    const bills = [bill("e", new Date("2026-06-25"))];
    expect(dueBills(bills, today)).toHaveLength(0);
  });

  it("respects custom windowDays", () => {
    const bills = [bill("f", new Date("2026-06-30"))]; // today + 4
    expect(dueBills(bills, today, 5)).toHaveLength(1);
    expect(dueBills(bills, today, 3)).toHaveLength(0);
  });

  it("filters a mixed list correctly", () => {
    const bills = [
      bill("1", new Date("2026-06-25")), // past
      bill("2", new Date("2026-06-26")), // today ✓
      bill("3", new Date("2026-06-28")), // in window ✓
      bill("4", new Date("2026-06-30")), // out of window
    ];
    const result = dueBills(bills, today);
    expect(result.map((b) => b.id)).toEqual(["2", "3"]);
  });

  it("returns empty array when no bills", () => {
    expect(dueBills([], today)).toEqual([]);
  });

  it("handles numeric amountCents (not just bigint)", () => {
    const b: BillLike = { id: "n", name: "n", amountCents: 500, dueDate: new Date("2026-06-26"), workspaceId: "ws" };
    expect(dueBills([b], today)).toHaveLength(1);
  });
});
