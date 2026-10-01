import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  insightUpsert: vi.fn(),
  budgetFindMany: vi.fn(),
}));

vi.mock("../src/database", () => ({
  prisma: {
    $queryRaw: db.queryRaw,
    insight: { upsert: db.insightUpsert },
    budget: { findMany: db.budgetFindMany },
  },
}));

import { computeInsights } from "../src/insights/compute.processor";
import { computeCashflowForecast } from "../src/insights/cashflow.processor";

type SqlLike = { sql: string };
const isSql = (v: unknown): v is SqlLike => typeof v === "object" && v !== null && typeof (v as SqlLike).sql === "string";

/** Reconstrói o texto do SQL de uma chamada de template tagged: fragmentos `Prisma.Sql` entram com o próprio `.sql`, demais valores viram `?`. */
function toSql(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((acc, s, i) => acc + s + (i < values.length ? (isSql(values[i]) ? values[i].sql : "?") : ""), "").replace(/\s+/g, " ");
}

const captured: string[] = [];

beforeEach(() => {
  captured.length = 0;
  db.queryRaw.mockReset();
  db.insightUpsert.mockReset();
  db.budgetFindMany.mockReset();
  db.queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    captured.push(toSql(strings, values));
    return [];
  });
  db.insightUpsert.mockResolvedValue({});
  db.budgetFindMany.mockResolvedValue([{ id: "b1", categoryId: "c1", limitCents: 10000n }]);
});

describe("consultas de insights respeitam o filtro de receita/despesa", () => {
  it("toda consulta sobre transactions exclui pareados e ignorados", async () => {
    await computeInsights({ workspaceId: "w" });
    await computeCashflowForecast({ workspaceId: "w" }, { ai: { narrate: vi.fn(async () => "") } as never });

    const txQueries = captured.filter((q) => /FROM transactions\b/.test(q));
    // picos, assinaturas, alertas de orçamento e previsão de fluxo de caixa
    expect(txQueries.length).toBeGreaterThanOrEqual(4);
    for (const q of txQueries) {
      expect(q).toMatch(/(\bt\.)?"transferPairId" IS NULL/);
      expect(q).toMatch(/(\bt\.)?"ignored" = false/);
    }
  });
});
