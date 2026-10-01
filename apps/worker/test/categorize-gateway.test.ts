import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { OpenRouterGateway } from "../src/ai/openrouter";

const ok = (content: string, tokens = 50) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: tokens } }),
});

beforeEach(() => fetchMock.mockReset());

describe("OpenRouterGateway.categorizeBatch", () => {
  it("envia o schema de resposta, valida e devolve os resultados e o custo", async () => {
    fetchMock.mockResolvedValue(ok(JSON.stringify({ results: [{ transactionId: "t1", categoryId: "c1", confidence: 0.9 }] })));
    const gw = new OpenRouterGateway("key", "vision-x", "text-x");
    const out = await gw.categorizeBatch({ system: "sys", user: "usr" });
    expect(out).toEqual({ results: [{ transactionId: "t1", categoryId: "c1", confidence: 0.9 }], costTokens: 50 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("text-x");
    expect(body.response_format.json_schema.name).toBe("categorize");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("recupera JSON cercado de texto", async () => {
    fetchMock.mockResolvedValue(ok(`Claro! {"results":[{"transactionId":"t","categoryId":null,"confidence":0.1}]}`));
    const out = await new OpenRouterGateway("k", "v", "t").categorizeBatch({ system: "s", user: "u" });
    expect(out.results[0].categoryId).toBeNull();
  });

  it("lança em erro HTTP, JSON irrecuperável e confiança fora de 0–1", async () => {
    const gw = new OpenRouterGateway("k", "v", "t");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    await expect(gw.categorizeBatch({ system: "s", user: "u" })).rejects.toThrow(/OpenRouter 500/);
    fetchMock.mockResolvedValueOnce(ok("sem json nenhum"));
    await expect(gw.categorizeBatch({ system: "s", user: "u" })).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(ok(JSON.stringify({ results: [{ transactionId: "t", categoryId: "c", confidence: 2 }] })));
    await expect(gw.categorizeBatch({ system: "s", user: "u" })).rejects.toThrow();
  });
});
