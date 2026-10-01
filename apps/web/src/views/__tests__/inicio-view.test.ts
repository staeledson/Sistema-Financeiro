import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent } from "vue";

const { summaryMock } = vi.hoisted(() => ({ summaryMock: vi.fn() }));

vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  return { ...mod, api: { ...mod.api, summary: summaryMock } };
});

import InicioView from "../InicioView.vue";

const summary = {
  balances: { pfCents: 150000, pjCents: -20000, totalCents: 130000 },
  pendingCount: 7,
  nextInvoice: { accountId: "k1", name: "Cartão C6", dueDate: "2026-10-10", openInvoiceCents: 123456 },
  spending: {
    totalCents: 50000,
    insight: "Mercado subiu 18% vs. mês anterior",
    byCategory: [{ categoryId: "c1", name: "Mercado", totalCents: 50000, previousCents: 40000, pct: 100, count: 3 }],
    byMonth: { months: ["2026-09", "2026-10"], series: [{ key: "c1", categoryId: "c1", name: "Mercado", totalsCents: [100, 50000] }] },
    vsBudget: [],
  },
};

const EChartStub = defineComponent({ name: "EChart", props: ["option", "height", "label"], emits: ["click"], template: "<div class='echart-stub' />" });

async function mountInicio() {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: InicioView },
      { path: "/painel", component: { template: "<div />" } },
      { path: "/categorizar", component: { template: "<div />" } },
      { path: "/transacoes", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  await router.isReady();
  const w = mount(InicioView, { global: { plugins: [router], stubs: { EChart: EChartStub } } });
  await flushPromises();
  return { w, router };
}

beforeEach(() => summaryMock.mockReset().mockResolvedValue(summary));

describe("InicioView", () => {
  it("mostra saldos, pendências, próxima fatura e os gráficos do mês", async () => {
    const { w } = await mountInicio();
    expect(summaryMock.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const text = w.text().replace(/ /g, " ");
    expect(text).toContain("R$ 1.500,00");
    expect(text).toContain("R$ 1.300,00");
    expect(text).toContain("7");
    expect(text).toContain("Cartão C6");
    expect(text).toContain("10/10/2026");
    expect(text).toContain("R$ 1.234,56");
    expect(text).toContain("Mercado subiu 18%");
    expect(w.findAll(".echart-stub")).toHaveLength(2); // sem orçamento: pizza e empilhado
    expect(w.find('a[href="/categorizar"]').exists()).toBe(true);
    expect(w.find('a[href="/painel#sec-cartoes"]').text()).toContain("Cartão C6");
    expect(w.findAll('a[href="/painel"]').map((a) => a.text())).toContain("Abrir o painel");
  });

  it("sem fatura e sem despesas: estados vazios", async () => {
    summaryMock.mockResolvedValue({ ...summary, pendingCount: 0, nextInvoice: null, spending: { ...summary.spending, totalCents: 0, insight: null } });
    const { w } = await mountInicio();
    expect(w.text()).toContain("Nenhuma fatura a vencer");
    expect(w.text()).toContain("Nada para categorizar");
    expect(w.text()).toContain("Sem despesas este mês");
    expect(w.findAll(".echart-stub")).toHaveLength(0);
  });

  it("erro: mostra a mensagem e Tentar de novo recarrega", async () => {
    summaryMock.mockRejectedValueOnce(new Error("falhou"));
    const { w } = await mountInicio();
    expect(w.find('[role="alert"]').text()).toContain("falhou");
    await w.find('[role="alert"] button').trigger("click");
    await flushPromises();
    expect(summaryMock).toHaveBeenCalledTimes(2);
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.text()).toContain("Cartão C6");
  });
});
