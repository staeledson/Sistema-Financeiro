import { describe, it, expect } from "vitest";
import { sortBreakdown } from "../../lib/dashboard-format";

describe("sortBreakdown", () => {
  it("ordena por valor desc e calcula percentual sobre o total", () => {
    const out = sortBreakdown([
      { categoryId: "a", name: "Mercado", totalCents: 3000 },
      { categoryId: "b", name: "Lazer", totalCents: 7000 },
    ]);
    expect(out.map((o) => o.name)).toEqual(["Lazer", "Mercado"]);
    expect(out[0]).toEqual({ name: "Lazer", amountCents: 7000, pct: 70 });
    expect(out[1].pct).toBe(30);
  });

  it("usa 'Sem categoria' quando o nome vier vazio e pct 0 quando total é zero", () => {
    expect(sortBreakdown([{ categoryId: null, name: "", totalCents: 0 }])).toEqual([
      { name: "Sem categoria", amountCents: 0, pct: 0 },
    ]);
  });
});
