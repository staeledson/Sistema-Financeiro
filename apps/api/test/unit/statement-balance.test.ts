import { describe, it, expect } from "vitest";
import { currentStatementBalance } from "../../src/import/import-statement.service";

describe("currentStatementBalance", () => {
  it("devolve só o ponto marcado como corrente", () => {
    const r = currentStatementBalance([
      { dateISO: "2026-06-01", balanceCents: 100 },
      { dateISO: "2026-06-05", balanceCents: 1659, current: true },
    ]);
    expect(r).toEqual({ dateISO: "2026-06-05", balanceCents: 1659, current: true });
  });
  it("sem ponto corrente (ou sem pontos) não adivinha: null", () => {
    expect(currentStatementBalance([{ dateISO: "2026-06-01", balanceCents: 100 }, { dateISO: "2026-06-09", balanceCents: 200 }])).toBeNull();
    expect(currentStatementBalance([])).toBeNull();
  });
  it("com mais de um corrente vale o de data mais recente", () => {
    const r = currentStatementBalance([
      { dateISO: "2026-06-09", balanceCents: 900, current: true },
      { dateISO: "2026-06-05", balanceCents: 500, current: true },
    ]);
    expect(r?.balanceCents).toBe(900);
  });
});
