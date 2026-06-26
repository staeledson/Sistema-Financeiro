import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { OpenRouterGateway } from "../src/ai/openrouter";
import { mapCategory } from "../src/ai/category-map";

beforeEach(() => fetchMock.mockReset());

describe("OpenRouterGateway.parseText", () => {
  it("extrai e valida o rascunho", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "expense",
                amountCents: 3500,
                date: "2026-06-01",
                description: "Almoço iFood",
                counterparty: "iFood",
                suggestedCategory: "Restaurantes e delivery",
                confidence: 0.92,
              }),
            },
          },
        ],
        usage: { total_tokens: 120 },
      }),
    });

    const gw = new OpenRouterGateway("key", "vision-x", "text-x");
    const r = await gw.parseText("almoço 35 no ifood ontem");
    expect(r.draft.amountCents).toBe(3500);
    expect(r.draft.type).toBe("expense");
    expect(r.costTokens).toBe(120);
  });

  it("repara JSON com texto extra antes do objeto", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: "Aqui está o JSON:\n```json\n" + JSON.stringify({
                type: "income",
                amountCents: 50000,
                date: "2026-06-15",
                confidence: 0.85,
              }) + "\n```",
            },
          },
        ],
        usage: { total_tokens: 90 },
      }),
    });

    const gw = new OpenRouterGateway("key", "v", "t");
    const r = await gw.parseText("salário 500");
    expect(r.draft.type).toBe("income");
    expect(r.draft.amountCents).toBe(50000);
  });
});

describe("mapCategory", () => {
  const cats = [
    { id: "c1", name: "Restaurantes e delivery", type: "expense" },
    { id: "c2", name: "Salário", type: "income" },
  ];

  it("casa por nome case-insensitive", () => {
    expect(mapCategory("restaurantes e delivery", "expense", cats)).toBe("c1");
    expect(mapCategory("SALÁRIO", "income", cats)).toBe("c2");
  });

  it("retorna null se não encontrar", () => {
    expect(mapCategory("Inexistente", "expense", cats)).toBeNull();
  });

  it("retorna null para nome null/undefined", () => {
    expect(mapCategory(null, "expense", cats)).toBeNull();
    expect(mapCategory(undefined, "expense", cats)).toBeNull();
  });

  it("não casa tipo errado", () => {
    // "Salário" existe mas é income, não expense
    expect(mapCategory("Salário", "expense", cats)).toBeNull();
  });
});
