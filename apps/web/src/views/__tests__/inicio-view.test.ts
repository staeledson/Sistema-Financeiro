import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { defineComponent, nextTick } from "vue";

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
  accounts: [
    { accountId: "a-pf1", name: "Conta Inter", type: "checking", entity: "pf", institution: "inter", balanceCents: 160000, closingDay: null, dueDay: null },
    { accountId: "a-pf2", name: "Poupança BB", type: "savings", entity: "pf", institution: "bb", balanceCents: 0, closingDay: null, dueDay: null },
    { accountId: "a-pf3", name: "Carteira", type: "cash", entity: "pf", institution: "other", balanceCents: -10000, closingDay: null, dueDay: null },
    { accountId: "a-pj1", name: "Conta PJ C6", type: "checking", entity: "pj", institution: "c6", balanceCents: -20000, closingDay: null, dueDay: null },
    { accountId: "k1", name: "Cartão C6", type: "credit_card", entity: "pf", institution: "c6", balanceCents: -63113, closingDay: 10, dueDay: 17 },
    { accountId: "k2", name: "Cartão PJ", type: "credit_card", entity: "pj", institution: "other", balanceCents: -1000, closingDay: null, dueDay: null },
  ],
  pendingCount: 7,
  nextInvoice: { accountId: "k1", name: "Cartão C6", dueDate: "2026-10-10", openInvoiceCents: 123456, estimated: false },
  cardsConfigured: true,
  spending: {
    month: "2026-09",
    previousMonth: "2026-08",
    totalCents: 50000,
    byEntity: { pfCents: 20000, pjCents: 30000 },
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
      { path: "/contas", component: { template: "<div />" } },
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

  it("mostra a divisão PF/PJ dos gastos e filtra os gastos por entidade sem mexer nos saldos", async () => {
    const { w } = await mountInicio();
    expect(w.find(".split").text().replace(/\u00a0/g, " ")).toBe("PF R$ 200,00 · PJ R$ 300,00");
    const sel = w.find('select[aria-label="Entidade dos gastos"]');
    expect(sel.findAll("option").map((o) => o.text())).toEqual(["PF e PJ", "Pessoa Física", "Pessoa Jurídica"]);

    summaryMock.mockResolvedValueOnce({ ...summary, spending: { ...summary.spending, totalCents: 30000 } });
    await sel.setValue("pj");
    await flushPromises();
    expect(summaryMock).toHaveBeenCalledTimes(2);
    expect(summaryMock.mock.calls[1]).toEqual([localToday(), previousMonthOf(localToday()), "pj"]);
    expect(w.find("#sec-inicio-gastos").text()).toContain("Pessoa Jurídica");
    // a divisão continua mostrando os dois lados e os saldos não dependem do filtro
    expect(w.find(".split").text().replace(/\u00a0/g, " ")).toBe("PF R$ 200,00 · PJ R$ 300,00");

    expect(w.find('a[href*="entity=pj"]').exists()).toBe(true);

    await sel.setValue("all");
    await flushPromises();
    expect(summaryMock.mock.calls[2]).toEqual([localToday(), previousMonthOf(localToday())]);
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

  describe("detalhe dos saldos", () => {
    const nb = (t: string) => t.replace(/\u00a0/g, " ");
    const btn = (w: Awaited<ReturnType<typeof mountInicio>>["w"], kind: string) => w.find(`button[data-kind="${kind}"]`);
    const panel = (w: Awaited<ReturnType<typeof mountInicio>>["w"]) => w.find("#inicio-detalhe");

    it("os quatro cartões de saldo são botões fechados, ligados ao painel e com a dica 'ver detalhe'", async () => {
      const { w } = await mountInicio();
      for (const kind of ["pf", "pj", "total", "cards"]) {
        const b = btn(w, kind);
        expect(b.exists()).toBe(true);
        expect(b.attributes("type")).toBe("button");
        expect(b.attributes("aria-expanded")).toBe("false");
        expect(b.attributes("aria-controls")).toBe("inicio-detalhe");
        expect(b.text()).toContain("ver detalhe");
      }
      expect(panel(w).exists()).toBe(false);
    });

    it("clicar em Pessoa Física abre o painel só com as contas de caixa da PF e o total certo", async () => {
      const { w } = await mountInicio();
      await btn(w, "pf").trigger("click");
      expect(btn(w, "pf").attributes("aria-expanded")).toBe("true");
      const p = panel(w);
      expect(p.exists()).toBe(true);
      const text = nb(p.text());
      expect(text).toContain("Detalhe — Pessoa Física: R$ 1.500,00");
      expect(text).toContain("Conta Inter");
      expect(text).toContain("Poupança BB");
      expect(text).toContain("Carteira");
      expect(text).not.toContain("Conta PJ C6");
      expect(text).not.toContain("Cartão C6");
      expect(text).toContain("Conta corrente");
      expect(text).toContain("Inter");
      expect(text).toContain("R$ 1.600,00");
      expect(text).toContain("Cartões não entram no saldo em contas; veja Cartões a pagar.");
      // ordem: maior valor absoluto primeiro, zerada por último e esmaecida
      const rows = p.findAll("tbody tr");
      expect(rows.map((r) => r.find("th, td").text())).toEqual([expect.stringContaining("Conta Inter"), expect.stringContaining("Carteira"), expect.stringContaining("Poupança BB")]);
      expect(rows[2].classes()).toContain("zero");
      // tabela semântica
      expect(p.find("table caption").exists()).toBe(true);
      expect(p.findAll('th[scope="col"]').map((th) => th.text())).toEqual(expect.arrayContaining(["Conta", "Instituição", "Saldo"]));
      expect(p.find("tfoot").text()).toContain("Subtotal");
      expect(nb(p.find("tfoot").text())).toContain("R$ 1.500,00");
    });

    it("clicar de novo no mesmo cartão fecha; Escape fecha; Fechar fecha; aria-expanded acompanha", async () => {
      const { w } = await mountInicio();
      await btn(w, "pf").trigger("click");
      await btn(w, "pf").trigger("click");
      expect(panel(w).exists()).toBe(false);
      expect(btn(w, "pf").attributes("aria-expanded")).toBe("false");

      await btn(w, "pj").trigger("click");
      expect(panel(w).exists()).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await nextTick();
      expect(panel(w).exists()).toBe(false);
      expect(btn(w, "pj").attributes("aria-expanded")).toBe("false");

      await btn(w, "total").trigger("click");
      const close = panel(w).findAll("button").find((b) => b.text() === "Fechar");
      expect(close).toBeDefined();
      await close!.trigger("click");
      expect(panel(w).exists()).toBe(false);
      w.unmount();
    });

    it("um painel por vez: abrir outro cartão troca o conteúdo e o aria-expanded", async () => {
      const { w } = await mountInicio();
      await btn(w, "pf").trigger("click");
      await btn(w, "pj").trigger("click");
      expect(w.findAll("#inicio-detalhe")).toHaveLength(1);
      expect(btn(w, "pf").attributes("aria-expanded")).toBe("false");
      expect(btn(w, "pj").attributes("aria-expanded")).toBe("true");
      const text = nb(panel(w).text());
      expect(text).toContain("Detalhe — Pessoa Jurídica: -R$ 200,00");
      expect(text).toContain("Conta PJ C6");
      expect(text).not.toContain("Conta Inter");
    });

    it("Saldo total em contas mostra os grupos PF e PJ com subtotais e o total, sem cartões", async () => {
      const { w } = await mountInicio();
      await btn(w, "total").trigger("click");
      const p = panel(w);
      const text = nb(p.text());
      expect(text).toContain("Detalhe — Saldo total em contas: R$ 1.300,00");
      expect(p.findAll("table:not(.total-table) caption").map((c) => c.text())).toEqual([expect.stringContaining("Pessoa Física"), expect.stringContaining("Pessoa Jurídica")]);
      expect(text).toContain("Conta Inter");
      expect(text).toContain("Conta PJ C6");
      expect(text).not.toContain("Cartão C6");
      expect(text).toContain("Total");
      expect(text).toContain("R$ 1.500,00"); // subtotal PF
      expect(text).toContain("-R$ 200,00"); // subtotal PJ
    });

    it("Cartões a pagar mostra os cartões com valores negativos, dias configurados e o link para o Painel", async () => {
      const { w } = await mountInicio();
      await btn(w, "cards").trigger("click");
      expect(btn(w, "cards").attributes("aria-expanded")).toBe("true");
      const p = panel(w);
      const text = nb(p.text());
      expect(text).toContain("Detalhe — Cartões a pagar: -R$ 641,13");
      expect(text).toContain("Cartão C6");
      expect(text).toContain("-R$ 631,13");
      expect(text).toContain("Cartão PJ");
      expect(text).toContain("-R$ 10,00");
      expect(text).toContain("fecha dia 10 · vence dia 17");
      expect(text).not.toContain("fecha dia undefined");
      expect(text).not.toContain("Conta Inter");
      expect(text).toContain("Valor devido de cada cartão (fatura aberta + parcelas lançadas); detalhes da fatura no Painel.");
      expect(p.find('a[href="/painel#sec-cartoes"]').exists()).toBe(true);
      expect(text).not.toContain("Cartões não entram no saldo em contas");
    });

    it("cada linha tem os links Ver lançamentos (/transacoes?accountId=) e Conciliar saldo (/contas)", async () => {
      const { w } = await mountInicio();
      await btn(w, "pf").trigger("click");
      const links = panel(w).findAll("a");
      const tx = links.filter((a) => a.text() === "Ver lançamentos").map((a) => a.attributes("href"));
      expect(tx).toEqual(["/transacoes?accountId=a-pf1", "/transacoes?accountId=a-pf3", "/transacoes?accountId=a-pf2"]);
      const rec = links.filter((a) => a.text() === "Conciliar saldo").map((a) => a.attributes("href"));
      expect(rec).toEqual(["/contas", "/contas", "/contas"]);
    });

    it("sem contas no grupo: mostra o estado vazio em vez de tabela", async () => {
      summaryMock.mockResolvedValue({ ...summary, accounts: [] });
      const { w } = await mountInicio();
      await btn(w, "pf").trigger("click");
      expect(panel(w).find("table").exists()).toBe(false);
      expect(panel(w).text()).toContain("Nenhuma conta para detalhar");
    });

    it("sem dívida de cartão o cartão 'Cartões a pagar' não existe, então não há como abrir seu detalhe", async () => {
      summaryMock.mockResolvedValue({ ...summary, balances: { ...summary.balances, cards: { pfCents: 0, pjCents: 0, totalCents: 0 } } });
      const { w } = await mountInicio();
      expect(btn(w, "cards").exists()).toBe(false);
    });
  });
});
