import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

const { listMock, unpairMock, unignoreMock } = vi.hoisted(() => ({ listMock: vi.fn(), unpairMock: vi.fn(), unignoreMock: vi.fn() }));

vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      accounts: { ...mod.api.accounts, list: vi.fn(async () => []) },
      categories: { list: vi.fn(async () => [{ id: "c1", type: "expense", name: "Mercado", parentId: null, icon: null, color: null, isSystem: false, entity: "both" }]) },
      transactions: { ...mod.api.transactions, list: listMock },
      review: { ...mod.api.review, unpair: unpairMock, unignore: unignoreMock },
    },
  };
});

import TransactionsView from "../TransactionsView.vue";

async function mountAt(url: string) {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/transacoes", component: TransactionsView }],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(TransactionsView, { global: { plugins: [router] } });
  await flushPromises();
  return { w, router };
}

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([]);
  unpairMock.mockReset().mockResolvedValue({ unpaired: 2 });
  unignoreMock.mockReset().mockResolvedValue({ unignored: 1 });
});

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, type: "expense", amountCents: 1000, date: "2026-06-10T00:00:00.000Z", accountId: "a1", sourceAccountId: null, destAccountId: null,
  categoryId: "c1", description: `Lançamento ${id}`, counterparty: null, transferPairId: null, ignored: false,
  categorySource: "manual", reviewStatus: "ok", installmentCurrent: null, installmentTotal: null, ...over,
});

describe("TransactionsView com filtros da URL", () => {
  it("lê from/to/categoryId/accountId/entity/q/type/reportable e os envia à lista", async () => {
    await mountAt("/transacoes?from=2026-06-01&to=2026-06-30&categoryId=c1&accountId=a1&entity=pj&q=mer&type=expense&reportable=1");
    expect(listMock).toHaveBeenCalledWith({
      from: "2026-06-01", to: "2026-06-30", categoryId: "c1", accountId: "a1", entity: "pj", q: "mer", type: "expense", reportable: true,
    });
  });

  it("reportable sem type income/expense é ignorado (a API daria 400)", async () => {
    await mountAt("/transacoes?categoryId=c1&reportable=1");
    expect(listMock.mock.calls[0][0].reportable).toBeUndefined();
    await mountAt("/transacoes?type=transfer&reportable=1");
    expect(listMock.mock.calls[1][0].reportable).toBeUndefined();
  });

  it("chip mostra 'Sem categoria' para __none", async () => {
    const { w } = await mountAt("/transacoes?categoryId=__none&type=expense&reportable=1");
    expect(w.find(".category-chip").text()).toContain("Sem categoria");
    expect(listMock.mock.calls[0][0].categoryId).toBe("__none");
  });

  it("chip mostra o nome da categoria e Limpar remove categoria, tipo e reportable da URL", async () => {
    const { w, router } = await mountAt("/transacoes?from=2026-06-01&to=2026-06-30&categoryId=c1&type=expense&reportable=1");
    expect(w.find(".category-chip").text()).toContain("Mercado");
    await w.find(".category-chip button").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(w.find(".category-chip").exists()).toBe(false);
    const last = listMock.mock.calls[listMock.mock.calls.length - 1][0];
    expect(last.categoryId).toBeUndefined();
    expect(last.type).toBeUndefined();
    expect(last.reportable).toBeUndefined();
    expect(last.from).toBe("2026-06-01");
  });
});

describe("TransactionsView selos, ações e filtro rápido", () => {
  const rows = () => [
    row("t1"),
    row("t2", { transferPairId: "p1", type: "income", categoryId: null, categorySource: "none" }),
    row("t3", { ignored: true, reviewStatus: "ok", categoryId: null, categorySource: "none" }),
    row("t4", { reviewStatus: "pending", categoryId: null, categorySource: "none" }),
    row("t5", { installmentCurrent: 2, installmentTotal: 6, categorySource: "rule" }),
  ];

  it("mostra os selos de par, ignorado, parcela, sem categoria e a origem da categoria", async () => {
    listMock.mockResolvedValue(rows());
    const { w } = await mountAt("/transacoes");
    const items = w.findAll(".tx-item");
    expect(items).toHaveLength(5);
    expect(items[0].text()).toContain("Categoria: manual");
    expect(items[1].text()).toContain("Transferência pareada");
    expect(items[1].text()).toContain("Desfazer par");
    expect(items[2].text()).toContain("Ignorado");
    expect(items[2].text()).toContain("Reativar");
    expect(items[2].text()).not.toContain("Sem categoria");
    expect(items[3].text()).toContain("Sem categoria");
    expect(items[4].text()).toContain("Parcela 2/6");
    expect(items[4].text()).toContain("Categoria: regra");
  });

  it("filtro rápido: pareados, ignorados e pendentes", async () => {
    listMock.mockResolvedValue(rows());
    const { w } = await mountAt("/transacoes");
    const click = async (label: string) => {
      await w.findAll(".show-filter button").find((b) => b.text() === label)!.trigger("click");
    };
    await click("Pareados");
    expect(w.findAll(".tx-item").map((i) => i.text())).toEqual([expect.stringContaining("Lançamento t2")]);
    await click("Ignorados");
    expect(w.findAll(".tx-item").map((i) => i.text())).toEqual([expect.stringContaining("Lançamento t3")]);
    await click("Pendentes");
    expect(w.findAll(".tx-item").map((i) => i.text())).toEqual([expect.stringContaining("Lançamento t4")]);
    await click("Todos");
    expect(w.findAll(".tx-item")).toHaveLength(5);
  });

  it("Desfazer par e Reativar chamam a API e recarregam a lista", async () => {
    listMock.mockResolvedValue(rows());
    const { w } = await mountAt("/transacoes");
    const before = listMock.mock.calls.length;
    await w.findAll(".tx-item")[1].find(".tag-action").trigger("click");
    await flushPromises();
    expect(unpairMock).toHaveBeenCalledWith("p1");
    expect(listMock.mock.calls.length).toBe(before + 1);
    await w.findAll(".tx-item")[2].find(".tag-action").trigger("click");
    await flushPromises();
    expect(unignoreMock).toHaveBeenCalledWith(["t3"]);
    expect(listMock.mock.calls.length).toBe(before + 2);
  });

  it("erro da API aparece como alerta e a lista não é recarregada", async () => {
    listMock.mockResolvedValue(rows());
    unpairMock.mockRejectedValue(new Error("par não encontrado"));
    const { w } = await mountAt("/transacoes");
    const before = listMock.mock.calls.length;
    await w.findAll(".tx-item")[1].find(".tag-action").trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toContain("par não encontrado");
    expect(listMock.mock.calls.length).toBe(before);
  });
});
