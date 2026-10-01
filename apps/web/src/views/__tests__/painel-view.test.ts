import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent } from "vue";

const { spendingMock, cardsMock, cashflowMock, accountsMock } = vi.hoisted(() => ({
  spendingMock: vi.fn(), cardsMock: vi.fn(), cashflowMock: vi.fn(), accountsMock: vi.fn(),
}));

vi.mock("../../lib/api", async (orig) => {
  const mod = await orig<typeof import("../../lib/api")>();
  return {
    ...mod,
    api: {
      ...mod.api,
      accounts: { ...mod.api.accounts, list: accountsMock },
      dashboard: { ...mod.api.dashboard, spending: spendingMock, cards: cardsMock, cashflow: cashflowMock },
    },
  };
});

import PainelView from "../PainelView.vue";
import { useWorkspaceStore } from "../../stores/workspace";

const period = { kind: "month", from: "2026-06-01", to: "2026-06-30", label: "06/2026" };
const spending = {
  period,
  previousPeriod: { ...period, from: "2026-05-01", to: "2026-05-31", label: "05/2026" },
  totalCents: 45000,
  previousTotalCents: 36000,
  insight: "Mercado subiu 150% vs. período anterior",
  byCategory: [
    { categoryId: "c1", name: "Mercado", totalCents: 30000, previousCents: 6000, pct: 67, count: 2 },
    { categoryId: "__none", name: "Sem categoria", totalCents: 15000, previousCents: 0, pct: 33, count: 1 },
  ],
  byMonth: {
    months: ["2026-05", "2026-06"],
    series: [
      { key: "c1", categoryId: "c1", name: "Mercado", totalsCents: [6000, 45000] },
      { key: "__none", categoryId: null, name: "Sem categoria", totalsCents: [0, 5000] },
      { key: "__others", categoryId: null, name: "Outras", totalsCents: [1000, 2000] },
    ],
  },
  vsBudget: [{ categoryId: "c1", name: "Mercado", limitCents: 20000, spentCents: 45000, pct: 225 }],
  topCounterparties: [{ name: "Software SA", totalCents: 30000, count: 1 }],
  recurring: [],
};
const cashflow = {
  balances: {
    accounts: [],
    consolidated: { pfCents: 1000, pjCents: 2000, totalCents: 3000 },
    cards: { pfCents: 0, pjCents: 0, totalCents: 0 },
  },
  monthly: [
    { month: "2026-05", incomeCents: 90, expenseCents: 40, transfersNetCents: 0, balanceCents: 2900 },
    { month: "2026-06", incomeCents: 100, expenseCents: 50, transfersNetCents: 700, balanceCents: 3000 },
  ],
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
  accountsMock.mockReset().mockResolvedValue([]);
});

describe("PainelView", () => {
  it("renderiza os três blocos na ordem da spec e envia só os parâmetros do filtro", async () => {
    const { w } = await mountAt("/painel?month=2026-06&entity=pj");
    const titles = w.findAll("h3.block-title").map((h) => h.text());
    expect(titles).toEqual(["Para onde vai o dinheiro", "Cartões e faturas", "Fluxo de caixa"]);
    expect(spendingMock.mock.calls[0][0].toString()).toMatch(/^entity=pj&month=2026-06&asOf=\d{4}-\d{2}-\d{2}$/);
    expect(cardsMock.mock.calls[0][0].toString()).toMatch(/^entity=pj&asOf=\d{4}-\d{2}-\d{2}$/);
    expect(cashflowMock.mock.calls[0][0].toString()).toMatch(/^entity=pj&asOf=\d{4}-\d{2}-\d{2}$/);
    expect(w.text()).toContain("Mercado subiu 150%");
    expect(w.text()).toContain("Transferências internas no mês");
  });

  it("saldo em contas exclui cartões; a dívida aparece como linha secundária e o cartão segue na tabela por conta", async () => {
    cashflowMock.mockResolvedValue({
      ...cashflow,
      balances: {
        accounts: [
          { accountId: "a1", name: "Corrente", type: "checking", entity: "pf", balanceCents: 7737 },
          { accountId: "k1", name: "Cartão Nubank", type: "credit_card", entity: "pf", balanceCents: -63113 },
        ],
        consolidated: { pfCents: 7737, pjCents: 0, totalCents: 7737 },
        cards: { pfCents: -63113, pjCents: 0, totalCents: -63113 },
      },
    });
    const { w } = await mountAt("/painel");
    const text = w.text().replace(/\u00a0/g, " ");
    expect(text).toContain("Saldo em contas (sem cartões)");
    expect(text).not.toContain("Saldo consolidado");
    expect(text).toContain("R$ 77,37");
    expect(text).toContain("Cartões a pagar: -R$ 631,13");
    const rows = w.findAll("tbody tr").map((r) => r.text().replace(/\u00a0/g, " "));
    const cardRow = rows.find((r) => r.includes("Cartão Nubank"));
    expect(cardRow).toContain("-R$ 631,13");
    expect(cardRow).toContain("dívida do cartão");
    expect(rows.find((r) => r.includes("Corrente"))).not.toContain("dívida do cartão");
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

  it("cartão com saldo devedor mas fatura zerada mostra a dica do saldo devedor; com fatura calculada não", async () => {
    const card = {
      accountId: "k1", name: "C6", entity: "pf", configured: true, closingDay: 9, dueDay: 15, creditLimitCents: null,
      usedCents: 45269, limitUsedPct: null, openInvoiceCents: 0, closingDate: "2026-10-09", dueDate: "2026-10-15",
      cycleDaily: [], installmentsAhead: [], invoicePayments: [],
    };
    cardsMock.mockResolvedValue({ cards: [card] });
    const { w } = await mountAt("/painel");
    const hint = w.find(".debt-hint");
    expect(hint.exists()).toBe(true);
    expect(hint.text().replace(/\s/g, " ")).toContain("Saldo devedor do cartão: R$ 452,69 (importe a fatura atual para detalhar)");

    cardsMock.mockResolvedValue({ cards: [{ ...card, openInvoiceCents: 45269 }] });
    const { w: w2 } = await mountAt("/painel");
    expect(w2.find(".debt-hint").exists()).toBe(false);
  });

  it("falha de uma seção não derruba as outras", async () => {
    cardsMock.mockRejectedValue(new Error("falhou cartões"));
    const { w } = await mountAt("/painel");
    expect(w.text()).toContain("falhou cartões");
    expect(w.text()).toContain("Mercado subiu 150%");
    expect(w.text()).toContain("Saldo em contas (sem cartões)");
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

  describe("cliques nos gráficos", () => {
    const echarts = (w: Awaited<ReturnType<typeof mountAt>>["w"]) => w.findAllComponents({ name: "EChart" });
    const click = (w: Awaited<ReturnType<typeof mountAt>>["w"], idx: number, payload: object) =>
      echarts(w)[idx].vm.$emit("click", { name: "", seriesName: "", dataIndex: 0, seriesIndex: 0, ...payload });
    const SCOPE = "/painel?month=2026-06&entity=pf";

    it("pizza: abre as despesas da categoria (type=expense&reportable=1) e Sem categoria usa __none", async () => {
      const { w, router } = await mountAt(SCOPE);
      click(w, 0, { dataIndex: 0 });
      await flushPromises();
      expect(router.currentRoute.value.path).toBe("/transacoes");
      expect(router.currentRoute.value.query).toEqual({
        from: "2026-06-01", to: "2026-06-30", entity: "pf", categoryId: "c1", type: "expense", reportable: "1",
      });
    });

    it("pizza: Sem categoria leva categoryId=__none", async () => {
      const { w, router } = await mountAt(SCOPE);
      click(w, 0, { dataIndex: 1 });
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ categoryId: "__none", type: "expense", reportable: "1" });
    });

    it("barras empilhadas: série + mês viram categoria e intervalo do mês; Outras vai sem categoria", async () => {
      const { w, router } = await mountAt(SCOPE);
      click(w, 1, { seriesIndex: 0, dataIndex: 0 });
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({
        from: "2026-05-01", to: "2026-05-31", entity: "pf", categoryId: "c1", type: "expense", reportable: "1",
      });
      await router.push(SCOPE);
      click(w, 1, { seriesIndex: 1, dataIndex: 1 });
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ categoryId: "__none", from: "2026-06-01", to: "2026-06-30" });
      await router.push(SCOPE);
      click(w, 1, { seriesIndex: 2, dataIndex: 1 });
      await flushPromises();
      expect(router.currentRoute.value.query.categoryId).toBeUndefined();
      expect(router.currentRoute.value.query).toMatchObject({ type: "expense", reportable: "1" });
    });

    it("barras de orçamento: abre a categoria do orçamento", async () => {
      const { w, router } = await mountAt(SCOPE);
      click(w, 2, { dataIndex: 0 });
      await flushPromises();
      expect(router.currentRoute.value.query).toMatchObject({ categoryId: "c1", type: "expense", reportable: "1", from: "2026-06-01" });
    });

    it("fluxo de caixa: clicar num mês abre as transações do mês no mesmo escopo", async () => {
      const { w, router } = await mountAt(SCOPE);
      const list = echarts(w);
      click(w, list.length - 1, { dataIndex: 0 }); // o último gráfico da tela é o de barras do fluxo de caixa (a previsão vem antes)
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ from: "2026-05-01", to: "2026-05-31", entity: "pf" });
    });

    it("links do fluxo apontam para o último mês da série, não para o período do filtro", async () => {
      const { w } = await mountAt("/painel?month=2026-01&entity=pj");
      const hrefs = w.findAll("a.card-link").map((a) => a.attributes("href")!);
      expect(hrefs.some((h) => h.includes("from=2026-06-01") && h.includes("to=2026-06-30") && h.includes("entity=pj"))).toBe(true);
    });

    it("Saldo em contas não é um link", async () => {
      const { w } = await mountAt(SCOPE);
      const card = w.findAll("section").find((el) => el.text().includes("Saldo em contas") && !el.text().includes("Fluxo de caixa"))!;
      expect(card.element.tagName).toBe("SECTION");
    });
  });

  describe("conta no filtro", () => {
    const accounts = [
      { id: "pf1", name: "PF Conta", entity: "pf", archived: false, type: "checking" },
      { id: "pj1", name: "PJ Conta", entity: "pj", archived: false, type: "checking" },
    ];

    it("trocar a entidade tira da query uma conta de outra entidade", async () => {
      accountsMock.mockResolvedValue(accounts);
      const { w, router } = await mountAt("/painel?month=2026-06&accountId=pf1");
      expect(router.currentRoute.value.query.accountId).toBe("pf1");
      await w.find('select[aria-label="Entidade"]').setValue("pj");
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ entity: "pj", month: "2026-06" });
    });

    it("conta da URL que não existe na lista é removida antes de consultar a API", async () => {
      accountsMock.mockResolvedValue(accounts);
      const { router } = await mountAt("/painel?month=2026-06&accountId=fantasma");
      expect(router.currentRoute.value.query).toEqual({ month: "2026-06" });
      for (const mock of [spendingMock, cardsMock, cashflowMock]) {
        for (const call of mock.mock.calls) expect(call[0].has("accountId")).toBe(false);
      }
    });

    it("conta válida permanece e vai para a API", async () => {
      accountsMock.mockResolvedValue(accounts);
      const { router } = await mountAt("/painel?month=2026-06&accountId=pf1");
      expect(router.currentRoute.value.query.accountId).toBe("pf1");
      expect(cardsMock.mock.calls[0][0].get("accountId")).toBe("pf1");
    });

    it("trocar de workspace limpa a conta e recarrega as seções", async () => {
      accountsMock.mockResolvedValue(accounts);
      const { router } = await mountAt("/painel?month=2026-06&accountId=pf1");
      const before = spendingMock.mock.calls.length;
      const ws = useWorkspaceStore();
      ws.setActive("outro-workspace");
      await flushPromises();
      expect(router.currentRoute.value.query).toEqual({ month: "2026-06" });
      expect(spendingMock.mock.calls.length).toBeGreaterThan(before);
      expect(spendingMock.mock.calls[spendingMock.mock.calls.length - 1][0].has("accountId")).toBe(false);
    });
  });

  it("opções dos gráficos do cartão são estáveis quando só outra seção recarrega (sem reanimar)", async () => {
    cardsMock.mockResolvedValue({
      cards: [{
        accountId: "k1", name: "C6", entity: "pf", configured: true, closingDay: 20, dueDay: 28, creditLimitCents: 100000,
        usedCents: 5000, limitUsedPct: 5, openInvoiceCents: 5000, closingDate: "2026-06-20", dueDate: "2026-06-28",
        cycleDaily: [{ day: 1, currentCents: 100, avgPreviousCents: 50 }],
        installmentsAhead: [{ month: "2026-07", amountCents: 1000, count: 1 }],
        invoicePayments: [],
      }],
    });
    const { w, router } = await mountAt("/painel?month=2026-06");
    const cardOptions = () =>
      w.findAllComponents({ name: "EChart" }).map((c) => c.props("option")).filter((o) => typeof o === "function").slice(3, 5); // ciclo e parcelas (depois de pizza, empilhado e orçamento)
    const before = cardOptions();
    expect(before).toHaveLength(2);
    await router.replace({ query: { month: "2026-05" } }); // só `spending` recarrega
    await flushPromises();
    const after = cardOptions();
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(cardsMock).toHaveBeenCalledTimes(1);
  });
});
