import { describe, it, expect, vi } from "vitest";
import type { TransferCandidate } from "@app/shared";
import {
  CATEGORIZE_SYSTEM, planCategorization,
  type CatCategory, type CatRule, type CatSettings, type CatTx, type CategorizeAi,
} from "../src/ai/categorize.core";

const SETTINGS: CatSettings = { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] };

const CATS: CatCategory[] = [
  { id: "c-merc", name: "Supermercado", type: "expense", entity: "both" },
  { id: "c-forn", name: "Fornecedores", type: "expense", entity: "pj" },
  { id: "c-sal", name: "Salário", type: "income", entity: "both" },
];

let n = 0;
const tx = (over: Partial<CatTx> = {}): CatTx => ({
  id: `t${++n}`, type: "expense", amountCents: 1000, date: "2026-06-10", counterparty: null,
  description: "Compra qualquer", accountId: "a-pf", accountType: "checking", accountEntity: "pf", ...over,
});

const pool = (txs: CatTx[]): TransferCandidate[] =>
  txs.map((t) => ({ id: t.id, accountId: t.accountId!, accountType: t.accountType!, type: t.type, amountCents: t.amountCents, date: t.date, text: t.description ?? "" }));

function fakeAi(handler: (user: { categories: Array<{ id: string }>; transactions: Array<{ id: string }> }) => Array<{ transactionId: string; categoryId: string | null; confidence: number }>): CategorizeAi & { calls: number } {
  const ai = {
    calls: 0,
    categorizeBatch: vi.fn(async ({ user }: { system: string; user: string }) => {
      ai.calls++;
      return { results: handler(JSON.parse(user)), costTokens: 10 };
    }),
  };
  return ai;
}

const noAi = fakeAi(() => []);

describe("planCategorization", () => {
  it("pareia transferências internas e tira os lançamentos pareados dos passos seguintes", async () => {
    const saida = tx({ type: "expense", amountCents: 5000, accountId: "a-pj", accountEntity: "pj", description: "Pix enviado para STAEL EDSON" });
    const entrada = tx({ type: "income", amountCents: 5000, accountId: "a-pf", description: "Pix recebido de Empresa" });
    const ai = fakeAi(() => []);
    const plan = await planCategorization(
      { scope: [saida, entrada], pairPool: pool([saida, entrada]), categories: CATS, rules: [], examples: [], settings: SETTINGS }, ai,
    );
    expect(plan.transferPairs).toEqual([{ expenseId: saida.id, incomeId: entrada.id }]);
    expect(plan.byRule).toEqual([]);
    expect(plan.pending).toEqual([]);
    expect(ai.calls).toBe(0);
  });

  it("só aceita pares que envolvam um lançamento do escopo", async () => {
    const a = tx({ type: "expense", amountCents: 7000, accountId: "a-pj", accountEntity: "pj", description: "STAEL EDSON" });
    const b = tx({ type: "income", amountCents: 7000, accountId: "a-pf", description: "x" });
    const scope = tx({ description: "Outra coisa" });
    const plan = await planCategorization(
      { scope: [scope], pairPool: pool([a, b, scope]), categories: CATS, rules: [], examples: [], settings: SETTINGS }, fakeAi(() => []),
    );
    expect(plan.transferPairs).toEqual([]);
  });

  it("a regra vence a IA e a IA não é chamada para o que a regra resolveu", async () => {
    const t = tx({ description: "Supermercado Extra 123" });
    const rules: CatRule[] = [{ id: "r1", matchType: "contains", pattern: "supermercado", categoryId: "c-merc", priority: 100 }];
    const ai = fakeAi(() => []);
    const plan = await planCategorization({ scope: [t], pairPool: [], categories: CATS, rules, examples: [], settings: SETTINGS }, ai);
    expect(plan.byRule).toEqual([{ txId: t.id, categoryId: "c-merc", ruleId: "r1" }]);
    expect(ai.calls).toBe(0);
  });

  it("ignora regra cuja categoria não serve ao lançamento (entidade ou tipo) e cai na IA", async () => {
    const t = tx({ description: "Fornecedor Alfa", accountEntity: "pf" });
    const rules: CatRule[] = [{ id: "r1", matchType: "contains", pattern: "fornecedor", categoryId: "c-forn", priority: 100 }];
    const ai = fakeAi((u) => u.transactions.map((x) => ({ transactionId: x.id, categoryId: "c-merc", confidence: 0.95 })));
    const plan = await planCategorization({ scope: [t], pairPool: [], categories: CATS, rules, examples: [], settings: SETTINGS }, ai);
    expect(plan.byRule).toEqual([]);
    expect(plan.byAi).toEqual([{ txId: t.id, categoryId: "c-merc", confidence: 0.95 }]);
  });

  it("IA com confiança alta aplica; baixa vira pendente com sugestão; categoria incompatível e ausente viram pendentes sem sugestão", async () => {
    const alta = tx({ description: "a" });
    const baixa = tx({ description: "b" });
    const errada = tx({ description: "c" }); // despesa: c-sal é receita
    const faltando = tx({ description: "d" });
    const ai = fakeAi(() => [
      { transactionId: alta.id, categoryId: "c-merc", confidence: 0.9 },
      { transactionId: baixa.id, categoryId: "c-merc", confidence: 0.5 },
      { transactionId: errada.id, categoryId: "c-sal", confidence: 0.99 },
    ]);
    const plan = await planCategorization(
      { scope: [alta, baixa, errada, faltando], pairPool: [], categories: CATS, rules: [], examples: [], settings: SETTINGS }, ai,
    );
    expect(plan.byAi).toEqual([{ txId: alta.id, categoryId: "c-merc", confidence: 0.9 }]);
    expect(plan.pending).toEqual([
      { txId: baixa.id, suggestedCategoryId: "c-merc", confidence: 0.5 },
      { txId: errada.id, suggestedCategoryId: null, confidence: null },
      { txId: faltando.id, suggestedCategoryId: null, confidence: null },
    ]);
  });

  it("categoria isSystem (catch-all) com confiança 0.95 vira pendência com sugestão; normal com 0.95 é aplicada", async () => {
    const generica = tx({ description: "QXZ 0099 KWRT" });
    const normal = tx({ description: "Mercado Bom" });
    const cats: CatCategory[] = [...CATS, { id: "c-outras", name: "Outras despesas", type: "expense", entity: "both", isSystem: true }];
    const ai = fakeAi(() => [
      { transactionId: generica.id, categoryId: "c-outras", confidence: 0.95 },
      { transactionId: normal.id, categoryId: "c-merc", confidence: 0.95 },
    ]);
    const plan = await planCategorization(
      { scope: [generica, normal], pairPool: [], categories: cats, rules: [], examples: [], settings: SETTINGS }, ai,
    );
    expect(plan.byAi).toEqual([{ txId: normal.id, categoryId: "c-merc", confidence: 0.95 }]);
    expect(plan.pending).toEqual([{ txId: generica.id, suggestedCategoryId: "c-outras", confidence: 0.95 }]);
  });

  it("o prompt orienta preferir categoryId null a uma categoria genérica", () => {
    expect(CATEGORIZE_SYSTEM).toMatch(/Prefira categoryId null a uma categoria genérica/);
  });

  it("falha da IA deixa o lote inteiro pendente e não lança", async () => {
    const a = tx();
    const b = tx();
    const ai: CategorizeAi = { categorizeBatch: vi.fn(async () => { throw new Error("rede caiu"); }) };
    const plan = await planCategorization({ scope: [a, b], pairPool: [], categories: CATS, rules: [], examples: [], settings: SETTINGS }, ai);
    expect(plan.byAi).toEqual([]);
    expect(plan.pending.map((p) => p.txId)).toEqual([a.id, b.id]);
    expect(plan.costTokens).toBe(0);
  });

  it("divide em lotes do tamanho configurado e separa as chamadas por entidade", async () => {
    const pf = [tx(), tx(), tx(), tx(), tx()];
    const pj = [tx({ accountEntity: "pj", accountId: "a-pj" })];
    const ai = fakeAi((u) => u.transactions.map((x) => ({ transactionId: x.id, categoryId: "c-merc", confidence: 0.9 })));
    const plan = await planCategorization(
      { scope: [...pf, ...pj], pairPool: [], categories: CATS, rules: [], examples: [], settings: { ...SETTINGS, aiBatchSize: 2 } }, ai,
    );
    expect(ai.calls).toBe(4); // pf: 3 lotes (2+2+1), pj: 1 lote
    expect(plan.byAi).toHaveLength(6);
    expect(plan.costTokens).toBe(40);
  });

  it("oferece à IA só as categorias compatíveis com a entidade e os exemplos da mesma entidade", async () => {
    const t = tx({ accountEntity: "pf" });
    const seen: string[] = [];
    const ai: CategorizeAi = {
      categorizeBatch: vi.fn(async ({ user }) => { seen.push(user); return { results: [], costTokens: null }; }),
    };
    await planCategorization(
      {
        scope: [t], pairPool: [], categories: CATS, rules: [],
        examples: [
          { text: "padaria do zé", categoryName: "Supermercado", entity: "pf" },
          { text: "nota fiscal cliente", categoryName: "Fornecedores", entity: "pj" },
        ],
        settings: SETTINGS,
      }, ai,
    );
    const sent = JSON.parse(seen[0]) as { categories: Array<{ id: string }>; examples: Array<{ descricao: string }> };
    expect(sent.categories.map((c) => c.id).sort()).toEqual(["c-merc", "c-sal"]);
    expect(sent.examples.map((e) => e.descricao)).toEqual(["padaria do zé"]);
  });

  it("limita a 30 exemplos, os mais parecidos primeiro", async () => {
    const t = tx({ description: "uber viagem sp" });
    const examples = Array.from({ length: 40 }, (_, i) => ({ text: i === 39 ? "uber viagem rj" : `loja numero ${i}`, categoryName: "Supermercado", entity: "pf" as const }));
    const seen: string[] = [];
    const ai: CategorizeAi = { categorizeBatch: vi.fn(async ({ user }) => { seen.push(user); return { results: [], costTokens: null }; }) };
    await planCategorization({ scope: [t], pairPool: [], categories: CATS, rules: [], examples, settings: SETTINGS }, ai);
    const sent = JSON.parse(seen[0]) as { examples: Array<{ descricao: string }> };
    expect(sent.examples).toHaveLength(30);
    expect(sent.examples[0].descricao).toBe("uber viagem rj");
  });

  it("escopo vazio não chama a IA", async () => {
    const plan = await planCategorization({ scope: [], pairPool: [], categories: CATS, rules: [], examples: [], settings: SETTINGS }, noAi);
    expect(plan).toEqual({ transferPairs: [], byRule: [], byAi: [], pending: [], costTokens: 0 });
  });

  it("tamanho de lote inválido (0 ou NaN) não lança e ainda categoriza", async () => {
    for (const size of [0, NaN]) {
      const a = tx();
      const b = tx();
      const ai = fakeAi((u) => u.transactions.map((x) => ({ transactionId: x.id, categoryId: "c-merc", confidence: 0.9 })));
      const plan = await planCategorization(
        { scope: [a, b], pairPool: [], categories: CATS, rules: [], examples: [], settings: { ...SETTINGS, aiBatchSize: size } }, ai,
      );
      expect(plan.byAi.map((h) => h.txId)).toEqual([a.id, b.id]);
    }
  });

  it("lançamentos sem conta (entidade nula) ficam no mesmo grupo, recebem todas as categorias e exemplos de qualquer entidade", async () => {
    const a = tx({ accountId: null, accountType: null, accountEntity: null, description: "padaria" });
    const b = tx({ accountId: null, accountType: null, accountEntity: null, description: "mercado" });
    const seen: string[] = [];
    const ai: CategorizeAi = { categorizeBatch: vi.fn(async ({ user }) => { seen.push(user); return { results: [], costTokens: null }; }) };
    await planCategorization(
      {
        scope: [a, b], pairPool: [], categories: CATS, rules: [],
        examples: [
          { text: "padaria do zé", categoryName: "Supermercado", entity: "pf" },
          { text: "nota fiscal cliente", categoryName: "Fornecedores", entity: "pj" },
        ],
        settings: SETTINGS,
      }, ai,
    );
    expect(seen).toHaveLength(1);
    const sent = JSON.parse(seen[0]) as { categories: Array<{ id: string }>; examples: Array<{ descricao: string }>; transactions: Array<{ id: string }> };
    expect(sent.transactions.map((t) => t.id)).toEqual([a.id, b.id]);
    expect(sent.categories.map((c) => c.id).sort()).toEqual(["c-forn", "c-merc", "c-sal"]);
    expect(sent.examples.map((e) => e.descricao).sort()).toEqual(["nota fiscal cliente", "padaria do zé"]);
  });

  it("ids duplicados na resposta da IA: o último resultado vence; ids desconhecidos são ignorados", async () => {
    const t = tx({ description: "a" });
    const ai = fakeAi(() => [
      { transactionId: t.id, categoryId: "c-merc", confidence: 0.3 },
      { transactionId: "id-que-nao-existe", categoryId: "c-merc", confidence: 0.99 },
      { transactionId: t.id, categoryId: "c-merc", confidence: 0.95 },
    ]);
    const plan = await planCategorization({ scope: [t], pairPool: [], categories: CATS, rules: [], examples: [], settings: SETTINGS }, ai);
    expect(plan.byAi).toEqual([{ txId: t.id, categoryId: "c-merc", confidence: 0.95 }]);
    expect(plan.pending).toEqual([]);
  });
});
