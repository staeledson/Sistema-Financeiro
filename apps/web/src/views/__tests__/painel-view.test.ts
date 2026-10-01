import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent } from "vue";

const { spendingMock, cardsMock, cashflowMock } = vi.hoisted(() => ({ spendingMock: vi.fn(), cardsMock: vi.fn(), cashflowMock: vi.fn() }));

vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      accounts: { ...mod.api.accounts, list: vi.fn(async () => []) },
      dashboard: { ...mod.api.dashboard, spending: spendingMock, cards: cardsMock, cashflow: cashflowMock },
    },
  };
});

import PainelView from "../PainelView.vue";

const period = { kind: "month", from: "2026-06-01", to: "2026-06-30", label: "06/2026" };
const spending = {
  period,
  previousPeriod: { ...period, from: "2026-05-01", to: "2026-05-31", label: "05/2026" },
  totalCents: 45000,
  previousTotalCents: 36000,
  insight: "Mercado subiu 150% vs. período anterior",
  byCategory: [{ categoryId: "c1", name: "Mercado", totalCents: 45000, previousCents: 6000, pct: 100, count: 2 }],
  byMonth: { months: ["2026-06"], series: [] },
  vsBudget: [],
  topCounterparties: [{ name: "Software SA", totalCents: 30000, count: 1 }],
  recurring: [],
};
const cashflow = {
  balances: { accounts: [], consolidated: { pfCents: 1000, pjCents: 2000, totalCents: 3000 } },
  monthly: [{ month: "2026-06", incomeCents: 100, expenseCents: 50, transfersNetCents: 700, balanceCents: 3000 }],
  forecast: [],
};

const EChartStub = defineComponent({ name: "EChart", props: ["option", "height", "label"], emits: ["click"], template: "<div class='echart-stub' />" });

async function mountAt(url: string) {
  setActivePinia(createPinia());
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/painel", component: PainelView },
      { path: "/transacoes", component: { template: "<div />" } },
      { path: "/contas", component: { template: "<div />" } },
    ],
  });
  await router.push(url);
  await router.isReady();
  const w = mount(PainelView, { global: { plugins: [router], stubs: { EChart: EChartStub } } });
  await flushPromises();
  return { w, router };
}

beforeEach(() => {
  spendingMock.mockReset().mockResolvedValue(spending);
  cardsMock.mockReset().mockResolvedValue({ cards: [] });
  cashflowMock.mockReset().mockResolvedValue(cashflow);
});

describe("PainelView", () => {
  it("renderiza os três blocos na ordem da spec e envia só os parâmetros do filtro", async () => {
    const { w } = await mountAt("/painel?month=2026-06&entity=pj");
    const titles = w.findAll("h3.block-title").map((h) => h.text());
    expect(titles).toEqual(["Para onde vai o dinheiro", "Cartões e faturas", "Fluxo de caixa"]);
    expect(spendingMock.mock.calls[0][0].toString()).toBe("entity=pj&month=2026-06");
    expect(cardsMock.mock.calls[0][0].toString()).toBe("entity=pj");
    expect(cashflowMock.mock.calls[0][0].toString()).toBe("entity=pj");
    expect(w.text()).toContain("Mercado subiu 150%");
    expect(w.text()).toContain("Transferências internas no mês");
  });

  it("sem cartões: explica que cartão precisa de dias de fechamento e vencimento", async () => {
    const { w } = await mountAt("/painel");
    expect(w.text()).toContain("Nenhum cartão de crédito");
    expect(w.text()).toContain("fechamento e de vencimento");
    expect(w.find('a[href="/contas"]').exists()).toBe(true);
  });

  it("cartão não configurado mostra EmptyState com link para /contas", async () => {
    cardsMock.mockResolvedValue({
      cards: [{
        accountId: "k1", name: "C6", entity: "pf", configured: false, closingDay: null, dueDay: null, creditLimitCents: null,
        usedCents: 0, limitUsedPct: null, openInvoiceCents: null, closingDate: null, dueDate: null,
        cycleDaily: [], installmentsAhead: [], invoicePayments: [],
      }],
    });
    const { w } = await mountAt("/painel");
    expect(w.text()).toContain("não configurados");
    expect(w.find('a[href="/contas"]').exists()).toBe(true);
  });

  it("falha de uma seção não derruba as outras", async () => {
    cardsMock.mockRejectedValue(new Error("falhou cartões"));
    const { w } = await mountAt("/painel");
    expect(w.text()).toContain("falhou cartões");
    expect(w.text()).toContain("Mercado subiu 150%");
    expect(w.text()).toContain("Saldo consolidado");
  });

  it("mudar a entidade atualiza a URL e recarrega as seções", async () => {
    const { w, router } = await mountAt("/painel?month=2026-06");
    await w.find('select[aria-label="Entidade"]').setValue("pf");
    await flushPromises();
    expect(router.currentRoute.value.query).toEqual({ entity: "pf", month: "2026-06" });
    expect(spendingMock).toHaveBeenCalledTimes(2);
    expect(cardsMock).toHaveBeenCalledTimes(2);
  });

  it("mudar só o período não recarrega cartões nem fluxo de caixa", async () => {
    const { w, router } = await mountAt("/painel?month=2026-06");
    await router.replace({ query: { month: "2026-05" } });
    await flushPromises();
    expect(spendingMock).toHaveBeenCalledTimes(2);
    expect(cardsMock).toHaveBeenCalledTimes(1);
    expect(cashflowMock).toHaveBeenCalledTimes(1);
    w.unmount();
  });
});
