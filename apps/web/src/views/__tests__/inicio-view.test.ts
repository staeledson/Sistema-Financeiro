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
import { localToday, monthName, monthLabel, previousMonthOf } from "../../lib/dashboard-client";

const summary = {
  balances: {
    pfCents: 150000, pjCents: -20000, totalCents: 130000,
    cards: { pfCents: -63113, pjCents: -1000, totalCents: -64113 },
  },
  pendingCount: 7,
  nextInvoice: { accountId: "k1", name: "Cartão C6", dueDate: "2026-10-10", openInvoiceCents: 123456, estimated: false },
  cardsConfigured: true,
  spending: {
    month: "2026-09",
    previousMonth: "2026-08",
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
    expect(summaryMock.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}$/);
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

  it("o padrão dos gastos é o mês anterior; título e card nomeiam o mês (não 'do mês')", async () => {
    const month = previousMonthOf(localToday());
    const { w } = await mountInicio();
    expect(summaryMock.mock.calls[0]).toEqual([localToday(), month]);
    expect(w.find("#sec-inicio-gastos").text()).toBe(`Para onde foi o dinheiro em ${monthLabel(month)}`);
    const text = w.text();
    expect(text).toContain(`Despesas de ${monthName(month)}`);
    expect(text).not.toContain("Despesas do mês");
    const input = w.find('input[type="month"]');
    expect((input.element as HTMLInputElement).value).toBe(month);
    expect(input.attributes("max")).toBe(localToday().slice(0, 7));
    expect(w.find('label[for]').text()).toBe("Mês");
  });

  it("trocar o mês recarrega só o resumo com o novo month; vazio/inválido mantém o anterior; link da lista usa o mês", async () => {
    const { w } = await mountInicio();
    const input = w.find('input[type="month"]');
    await input.setValue("2026-03");
    await flushPromises();
    expect(summaryMock).toHaveBeenCalledTimes(2);
    expect(summaryMock.mock.calls[1]).toEqual([localToday(), "2026-03"]);
    expect(w.text()).toContain("Despesas de março de 2026");
    expect(w.find("#sec-inicio-gastos").text()).toContain("03/2026");
    expect(w.find('a[href*="from=2026-03-01"]').exists()).toBe(true);
    await input.setValue("");
    await flushPromises();
    expect(summaryMock).toHaveBeenCalledTimes(2);
    expect((w.find('input[type="month"]').element as HTMLInputElement).value).toBe("2026-03");
  });

  it("resposta antiga do mês anterior é descartada quando o mês muda de novo", async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve({ ...summary, spending: { ...summary.spending, totalCents: 111 } }), 20));
    const { w } = await mountInicio();
    summaryMock.mockReturnValueOnce(slow).mockResolvedValueOnce({ ...summary, spending: { ...summary.spending, totalCents: 222 } });
    await w.find('input[type="month"]').setValue("2026-02");
    await w.find('input[type="month"]').setValue("2026-01");
    await flushPromises();
    await new Promise((r) => setTimeout(r, 40));
    await flushPromises();
    expect(w.text().replace(/\u00a0/g, " ")).toContain("R$ 2,22");
    expect(w.text().replace(/\u00a0/g, " ")).not.toContain("R$ 1,11");
  });

  it("saldos de PF/PJ/total são caixa; a dívida dos cartões aparece à parte em 'Cartões a pagar'", async () => {
    const { w } = await mountInicio();
    const cards = w.find('[aria-label="Cartões a pagar"]');
    expect(cards.exists()).toBe(true);
    const text = cards.text().replace(/\u00a0/g, " ");
    expect(text).toContain("Cartões a pagar");
    expect(text).toContain("-R$ 641,13");
    expect(text).toContain("PF -R$ 631,13");
    expect(text).toContain("PJ -R$ 10,00");
    // o total em contas não inclui a dívida
    expect(w.find('[aria-label="Saldos"]').text().replace(/\u00a0/g, " ")).toContain("R$ 1.300,00");
  });

  it("sem dívida de cartão: não mostra 'Cartões a pagar'", async () => {
    summaryMock.mockResolvedValue({ ...summary, balances: { ...summary.balances, cards: { pfCents: 0, pjCents: 0, totalCents: 0 } } });
    const { w } = await mountInicio();
    expect(w.find('[aria-label="Cartões a pagar"]').exists()).toBe(false);
  });

  it("fatura estimada pelo saldo devedor mostra a observação; a calculada não", async () => {
    const { w } = await mountInicio();
    expect(w.text()).not.toContain("Saldo devedor do cartão");
    summaryMock.mockResolvedValue({ ...summary, nextInvoice: { ...summary.nextInvoice, openInvoiceCents: 45269, estimated: true } });
    const { w: w2 } = await mountInicio();
    expect(w2.text()).toContain("Cartão C6");
    expect(w2.text()).toContain("Saldo devedor do cartão (a fatura ainda não tem lançamentos importados)");
  });

  it("sem fatura: cartões configurados dizem só 'Nenhuma fatura a vencer.'; sem cartão configurado orienta a configurar", async () => {
    summaryMock.mockResolvedValue({ ...summary, nextInvoice: null, cardsConfigured: true });
    const { w } = await mountInicio();
    expect(w.text()).toContain("Nenhuma fatura a vencer.");
    expect(w.text()).not.toContain("dias de fechamento e vencimento");
    summaryMock.mockResolvedValue({ ...summary, nextInvoice: null, cardsConfigured: false });
    const { w: w2 } = await mountInicio();
    expect(w2.text()).toContain("Cartões precisam de dias de fechamento e vencimento em Contas.");
  });

  it("sem fatura e sem despesas: estados vazios", async () => {
    summaryMock.mockResolvedValue({ ...summary, pendingCount: 0, nextInvoice: null, spending: { ...summary.spending, totalCents: 0, insight: null } });
    const { w } = await mountInicio();
    expect(w.text()).toContain("Nenhuma fatura a vencer");
    expect(w.text()).toContain("Nada para categorizar");
    expect(w.text()).toContain(`Sem despesas em ${monthName(previousMonthOf(localToday()))}`);
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
