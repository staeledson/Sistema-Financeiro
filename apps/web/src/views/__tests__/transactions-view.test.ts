import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));

vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      accounts: { ...mod.api.accounts, list: vi.fn(async () => []) },
      categories: { list: vi.fn(async () => [{ id: "c1", type: "expense", name: "Mercado", parentId: null, icon: null, color: null, isSystem: false, entity: "both" }]) },
      transactions: { ...mod.api.transactions, list: listMock },
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

beforeEach(() => listMock.mockReset().mockResolvedValue([]));

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
