import { describe, it, expect } from "vitest";
import {
  foldText, normalizeDescriptionKey, trigramSimilarity, rankBySimilarity, chunk, categoryFits,
  aiBatchResultSchema, decideAiResult, detectTransferPairs, matchRule, applyRules,
  isCatchAllCategoryName, CATCH_ALL_CATEGORY_NAMES,
  type TransferCandidate,
} from "../index";

describe("normalização", () => {
  it("foldText tira acentos e caixa", () => {
    expect(foldText("José Açaí")).toBe("jose acai");
  });

  it("normalizeDescriptionKey agrupa variações da mesma descrição", () => {
    expect(normalizeDescriptionKey("iFood *Pedido 12345")).toBe("ifood pedido");
    expect(normalizeDescriptionKey("  IFOOD   pedido 998 ")).toBe("ifood pedido");
    expect(normalizeDescriptionKey(null)).toBe("");
    expect(normalizeDescriptionKey("PIX 001")).toBe("pix");
    expect(normalizeDescriptionKey("12345 - 99")).toBe("");
  });
});

describe("similaridade", () => {
  it("é 1 para textos iguais, 0 sem trigramas em comum e maior para o mais parecido", () => {
    expect(trigramSimilarity("supermercado extra", "Supermercado Extra 22")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
    expect(trigramSimilarity("", "abc")).toBe(0);
    expect(trigramSimilarity("uber viagem", "uber trip")).toBeGreaterThan(trigramSimilarity("uber viagem", "padaria pao"));
  });

  it("rankBySimilarity ordena por semelhança, desempata pela ordem original e respeita o limite", () => {
    const items = ["padaria pao", "uber viagem sp", "uber viagem rj", "farmacia"];
    expect(rankBySimilarity(items, (s) => s, "uber viagem", 2)).toEqual(["uber viagem sp", "uber viagem rj"]);
    expect(rankBySimilarity(items, (s) => s, "qualquer", 10)).toHaveLength(4);
  });

  it("chunk divide em blocos e rejeita tamanho inválido", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("categoryFits", () => {
  const exp = { type: "expense" as const, entity: "both" as const };
  it("exige o mesmo tipo e recusa transferência", () => {
    expect(categoryFits(exp, { type: "expense" }, "pf")).toBe(true);
    expect(categoryFits(exp, { type: "income" }, "pf")).toBe(false);
    expect(categoryFits(exp, { type: "transfer" }, "pf")).toBe(false);
  });

  it("categoria PJ só serve a conta PJ; both serve às duas; sem conta só confere o tipo", () => {
    const pj = { type: "expense" as const, entity: "pj" as const };
    expect(categoryFits(pj, { type: "expense" }, "pj")).toBe(true);
    expect(categoryFits(pj, { type: "expense" }, "pf")).toBe(false);
    expect(categoryFits(pj, { type: "expense" }, null)).toBe(true);
    expect(categoryFits(exp, { type: "expense" }, "pj")).toBe(true);
  });
});

describe("decideAiResult", () => {
  const valid = (id: string) => id === "c1";
  it("aplica quando a categoria é válida e a confiança alcança o limiar", () => {
    expect(decideAiResult({ transactionId: "t", categoryId: "c1", confidence: 0.8 }, valid, 0.8)).toEqual({
      status: "ok", categoryId: "c1", confidence: 0.8,
    });
  });

  it("vira pendente com sugestão quando a confiança fica abaixo do limiar", () => {
    expect(decideAiResult({ transactionId: "t", categoryId: "c1", confidence: 0.79 }, valid, 0.8)).toEqual({
      status: "pending", suggestedCategoryId: "c1", confidence: 0.79,
    });
  });

  it("vira pendente sem sugestão quando a categoria é inválida, nula ou o resultado não veio", () => {
    const none = { status: "pending", suggestedCategoryId: null, confidence: null };
    expect(decideAiResult({ transactionId: "t", categoryId: "zzz", confidence: 0.99 }, valid, 0.8)).toEqual(none);
    expect(decideAiResult({ transactionId: "t", categoryId: null, confidence: 0.99 }, valid, 0.8)).toEqual(none);
    expect(decideAiResult(undefined, valid, 0.8)).toEqual(none);
  });

  it("confiança não finita (NaN/Infinity) conta como sem resultado", () => {
    const none = { status: "pending", suggestedCategoryId: null, confidence: null };
    expect(decideAiResult({ transactionId: "t", categoryId: "c1", confidence: Number.NaN }, valid, 0.8)).toEqual(none);
    expect(decideAiResult({ transactionId: "t", categoryId: "c1", confidence: Number.POSITIVE_INFINITY }, valid, 0.8)).toEqual(none);
  });

  it("o schema da resposta rejeita confiança fora de 0–1", () => {
    expect(aiBatchResultSchema.safeParse({ results: [{ transactionId: "t", categoryId: null, confidence: 1.5 }] }).success).toBe(false);
    expect(aiBatchResultSchema.safeParse({ results: [{ transactionId: "t", categoryId: "c", confidence: 0.5 }] }).success).toBe(true);
  });
});

describe("detectTransferPairs", () => {
  const tx = (over: Partial<TransferCandidate> & { id: string }): TransferCandidate => ({
    accountId: "a1", accountType: "checking", type: "expense", amountCents: 10000, date: "2026-06-10", text: "", ...over,
  });
  const OWNERS = ["Stael Edson", "SEAS Solutions Ltda"];

  it("pareia PJ→PF quando o texto cita o titular ou a empresa", () => {
    const pairs = detectTransferPairs([
      tx({ id: "saida", accountId: "pj", type: "expense", text: "Pix enviado para STAEL EDSON" }),
      tx({ id: "entrada", accountId: "pf", type: "income", text: "Pix recebido de SEAS Solutions Ltda" }),
    ], { ownerNames: OWNERS, windowDays: 2 });
    expect(pairs).toEqual([["saida", "entrada"]]);
  });

  it("ignora acentos e caixa ao procurar o nome", () => {
    const pairs = detectTransferPairs([
      tx({ id: "s", accountId: "pj", text: "Pix para JOSÉ DA SILVA" }),
      tx({ id: "e", accountId: "pf", type: "income", text: "Pix recebido" }),
    ], { ownerNames: ["José da Silva"], windowDays: 2 });
    expect(pairs).toEqual([["s", "e"]]);
  });

  it("pareia pagamento de fatura quando uma das contas é cartão de crédito", () => {
    const pairs = detectTransferPairs([
      tx({ id: "pgto", accountId: "cc", type: "expense", text: "PGTO FAT CARTAO C6" }),
      tx({ id: "fatura", accountId: "card", accountType: "credit_card", type: "income", text: "Pagamento recebido" }),
    ], { ownerNames: [], windowDays: 2 });
    expect(pairs).toEqual([["pgto", "fatura"]]);
  });

  it("não pareia sem sinal textual, fora da janela, na mesma conta, no mesmo sentido ou com valor diferente", () => {
    const base = { ownerNames: OWNERS, windowDays: 2 };
    const a = tx({ id: "a", accountId: "x", text: "Pix enviado para Stael Edson" }); // cita o titular: sinal presente
    const semSinal = [tx({ id: "a", accountId: "x", text: "Padaria" }), tx({ id: "b", accountId: "y", type: "income", text: "Fulano" })];
    expect(detectTransferPairs(semSinal, base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", date: "2026-06-13", text: "x" })], base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "x", type: "income", text: "x" })], base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "expense", text: "x" })], base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", amountCents: 10001, text: "x" })], base)).toEqual([]);
  });

  it("a janela é inclusiva (2 dias pareia, 3 não)", () => {
    const a = tx({ id: "a", accountId: "x", text: "Stael Edson" });
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", date: "2026-06-12", text: "x" })], { ownerNames: OWNERS, windowDays: 2 })).toHaveLength(1);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", date: "2026-06-13", text: "x" })], { ownerNames: OWNERS, windowDays: 2 })).toHaveLength(0);
  });

  it("cada lançamento entra em no máximo um par e vence a contraparte mais próxima", () => {
    const pairs = detectTransferPairs([
      tx({ id: "saida", accountId: "x", text: "Stael Edson", date: "2026-06-10" }),
      tx({ id: "longe", accountId: "y", type: "income", text: "x", date: "2026-06-12" }),
      tx({ id: "perto", accountId: "z", type: "income", text: "x", date: "2026-06-10" }),
    ], { ownerNames: OWNERS, windowDays: 2 });
    expect(pairs).toEqual([["saida", "perto"]]);
  });

  it("vários pares iguais (mesmo valor e dia) são pareados um a um sem reaproveitar lançamentos", () => {
    const pairs = detectTransferPairs([
      tx({ id: "s1", accountId: "x", text: "Stael Edson" }),
      tx({ id: "s2", accountId: "x", text: "Stael Edson" }),
      tx({ id: "e1", accountId: "y", type: "income", text: "x" }),
      tx({ id: "e2", accountId: "y", type: "income", text: "x" }),
    ], { ownerNames: OWNERS, windowDays: 2 });
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.flat()).size).toBe(4);
  });

  it("aceita timestamps ISO completos e não pareia datas muito distantes", () => {
    const base = { ownerNames: OWNERS, windowDays: 2 };
    const longe = detectTransferPairs([
      tx({ id: "a", accountId: "x", text: "Stael Edson", date: "2026-01-01T00:00:00.000Z" }),
      tx({ id: "b", accountId: "y", type: "income", text: "x", date: "2026-09-01T00:00:00.000Z" }),
    ], base);
    expect(longe).toEqual([]);
    const perto = detectTransferPairs([
      tx({ id: "a", accountId: "x", text: "Stael Edson", date: "2026-06-10T03:00:00.000Z" }),
      tx({ id: "b", accountId: "y", type: "income", text: "x", date: "2026-06-11T03:00:00.000Z" }),
    ], base);
    expect(perto).toEqual([["a", "b"]]);
  });

  it("data inválida nunca pareia e não lança", () => {
    const pairs = detectTransferPairs([
      tx({ id: "a", accountId: "x", text: "Stael Edson", date: "abc" }),
      tx({ id: "b", accountId: "y", type: "income", text: "x", date: "2026-06-10" }),
    ], { ownerNames: OWNERS, windowDays: 2 });
    expect(pairs).toEqual([]);
  });

  it("nome do titular exige palavra inteira e tamanho mínimo", () => {
    const run = (text: string, owner: string) =>
      detectTransferPairs([
        tx({ id: "a", accountId: "x", text }),
        tx({ id: "b", accountId: "y", type: "income", text: "x" }),
      ], { ownerNames: [owner], windowDays: 2 });
    expect(run("Pix para Banana", "Ana")).toEqual([]);
    expect(run("Pix para Ana Silva", "Ana")).toEqual([["a", "b"]]);
    expect(run("PIX ENVIADO PARA STAEL EDSON - 123", "Stael Edson")).toEqual([["a", "b"]]);
    expect(run("stael-edson", "Stael Edson")).toEqual([["a", "b"]]);
    expect(run("Pix para A", "A")).toEqual([]);
    expect(run("Pix para Jo", "Jo")).toEqual([]);
    expect(run("a jo a", "Jo")).toEqual([]);
  });

  it("escala com muitos candidatos do mesmo valor espalhados no tempo", () => {
    const list: TransferCandidate[] = [];
    for (let i = 0; i < 2000; i++) {
      const day = new Date(Date.UTC(2020, 0, 1) + i * 5 * 86_400_000).toISOString().slice(0, 10);
      list.push(tx({
        id: `t${i}`,
        accountId: i % 2 === 0 ? "x" : "y",
        type: i % 2 === 0 ? "expense" : "income",
        date: day,
        text: "Stael Edson",
      }));
    }
    const pairs = detectTransferPairs(list, { ownerNames: OWNERS, windowDays: 2 });
    // vizinhos estão a 5 dias; ninguém cai na janela
    expect(pairs).toEqual([]);

    const close = [
      tx({ id: "e1", accountId: "x", type: "expense", date: "2026-06-10", text: "Stael Edson" }),
      tx({ id: "i1", accountId: "y", type: "income", date: "2026-06-11", text: "x" }),
      ...list.slice(0, 1000),
    ];
    expect(detectTransferPairs(close, { ownerNames: OWNERS, windowDays: 2 })).toEqual([["e1", "i1"]]);
  });
});

describe("matchRule", () => {
  const rules = [
    { id: "r1", matchType: "contains" as const, pattern: "ifood", categoryId: "c-rest", priority: 100 },
    { id: "r2", matchType: "equals" as const, pattern: "ifood club", categoryId: "c-assin", priority: 150 },
  ];
  it("devolve a regra inteira (com id) e respeita a prioridade", () => {
    expect(matchRule("iFood Club", rules)?.id).toBe("r2");
    expect(matchRule("iFood Pedido", rules)?.id).toBe("r1");
    expect(matchRule("Uber", rules)).toBeNull();
  });

  it("regex inválida conta como sem casamento e não impede regras de menor prioridade", () => {
    const bad = { id: "bad", matchType: "regex" as const, pattern: "(", categoryId: "c", priority: 100 };
    expect(matchRule("qualquer", [bad])).toBeNull();
    const uber = { id: "u", matchType: "contains" as const, pattern: "uber", categoryId: "c-uber", priority: 100 };
    expect(matchRule("Uber viagem", [{ ...bad, priority: 200 }, uber])?.id).toBe("u");
    expect(applyRules("qualquer", [bad])).toBeNull();
  });

  it("applyRules continua devolvendo só o id da categoria", () => {
    expect(applyRules("iFood Club", rules)).toBe("c-assin");
    expect(applyRules("Uber", rules)).toBeNull();
  });
});

describe("isCatchAllCategoryName", () => {
  it("reconhece só Outras despesas/Outras receitas, sem acento nem caixa", () => {
    expect(isCatchAllCategoryName("Outras despesas")).toBe(true);
    expect(isCatchAllCategoryName("  OUTRAS RECEITAS ")).toBe(true);
    expect(isCatchAllCategoryName("Supermercado")).toBe(false);
    expect(isCatchAllCategoryName(null)).toBe(false);
    expect(CATCH_ALL_CATEGORY_NAMES).toEqual(["Outras despesas", "Outras receitas"]);
  });
});
