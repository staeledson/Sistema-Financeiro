import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http", () => ({ http: vi.fn(async () => ({})) }));

import { http } from "../http";
import {
  getPending, categorizeGroup, acceptSuggestions, ignoreTransactions, markTransfer,
  getTransferCandidates, recategorize, listRules, deleteRule, categoriesForGroup,
} from "../review-client";

const last = () => {
  const calls = vi.mocked(http).mock.calls;
  const args = calls[calls.length - 1] ?? [];
  // sempre 3 posições (método, caminho, corpo): chamadas sem corpo trazem undefined no fim
  return [args[0], args[1], args[2]];
};

beforeEach(() => vi.mocked(http).mockClear());

describe("chamadas à API de revisão", () => {
  it("getPending monta a query só com os filtros informados", async () => {
    await getPending({});
    expect(last()).toEqual(["GET", "/review/pending", undefined]);
    await getPending({ entity: "pj", accountId: "a1" });
    expect(last()[1]).toBe("/review/pending?entity=pj&accountId=a1");
  });

  it("categorizeGroup envia createRule/applyToSimilar", async () => {
    await categorizeGroup({ transactionIds: ["t1"], categoryId: "c1", createRule: false, applyToSimilar: true });
    expect(last()).toEqual(["POST", "/review/categorize", { transactionIds: ["t1"], categoryId: "c1", createRule: false, applyToSimilar: true }]);
  });

  it("aceitar, ignorar, marcar transferência, candidatos e recategorizar", async () => {
    await acceptSuggestions(["t1"]);
    expect(last()).toEqual(["POST", "/review/accept-suggestion", { transactionIds: ["t1"] }]);
    await ignoreTransactions(["t1", "t2"]);
    expect(last()).toEqual(["POST", "/review/ignore", { transactionIds: ["t1", "t2"] }]);
    await markTransfer("t1", "t2");
    expect(last()).toEqual(["POST", "/review/mark-transfer", { transactionId: "t1", counterpartTransactionId: "t2" }]);
    await getTransferCandidates("t1");
    expect(last()[1]).toBe("/review/transfer-candidates?transactionId=t1");
    await recategorize();
    expect(last()).toEqual(["POST", "/review/recategorize", {}]);
  });

  it("regras: listar e excluir", async () => {
    await listRules();
    expect(last()[1]).toBe("/category-rules");
    await deleteRule("r1");
    expect(last()).toEqual(["DELETE", "/category-rules/r1", undefined]);
  });
});

describe("categoriesForGroup", () => {
  const cats = [
    { id: "a", type: "expense" as const, entity: "both" as const, name: "A" },
    { id: "b", type: "expense" as const, entity: "pj" as const, name: "B" },
    { id: "c", type: "income" as const, entity: "both" as const, name: "C" },
    { id: "d", type: "expense" as const, entity: "pf" as const, name: "D" },
  ];

  it("filtra por tipo do grupo e, quando o grupo tem entidade, pela entidade", () => {
    expect(categoriesForGroup(cats, { type: "expense", entity: "pj" }).map((c) => c.id)).toEqual(["a", "b"]);
    expect(categoriesForGroup(cats, { type: "expense", entity: "pf" }).map((c) => c.id)).toEqual(["a", "d"]);
    expect(categoriesForGroup(cats, { type: "income", entity: null }).map((c) => c.id)).toEqual(["c"]);
  });

  it("grupo de entidade mista ou sem conta mostra todas as categorias do tipo", () => {
    expect(categoriesForGroup(cats, { type: "expense", entity: null }).map((c) => c.id)).toEqual(["a", "b", "d"]);
  });
});
