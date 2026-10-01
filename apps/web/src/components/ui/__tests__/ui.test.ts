import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Money from "../Money.vue";
import PeriodPicker from "../PeriodPicker.vue";
import Card from "../Card.vue";
import DataTable from "../DataTable.vue";
import EntityBadge from "../EntityBadge.vue";
import { createRouter, createMemoryHistory } from "vue-router";

describe("Money", () => {
  it("formata em reais e colore pelo sinal", () => {
    const w = mount(Money, { props: { cents: -1234, colored: true } });
    expect(w.text()).toContain("12,34");
    expect(w.classes()).toContain("neg");
  });

  it("sem colored não aplica classe de sinal; compact abrevia", () => {
    const w = mount(Money, { props: { cents: 120_000_00, compact: true } });
    expect(w.text()).toBe("R$\u00a0120 mil");
    expect(w.classes()).toEqual(["money"]);
  });
});

describe("PeriodPicker", () => {
  function lastEmit(w: ReturnType<typeof mount>) {
    const ev = w.emitted("update:modelValue")!;
    return ev[ev.length - 1][0];
  }

  it("mês: emite só { month }", async () => {
    const w = mount(PeriodPicker, { props: { modelValue: { month: "2026-09" } } });
    const input = w.find('input[type="month"]');
    await input.setValue("2026-08");
    await input.trigger("change");
    expect(lastEmit(w)).toEqual({ month: "2026-08" });
  });

  it("trocar para trimestre emite só { quarter }", async () => {
    const w = mount(PeriodPicker, { props: { modelValue: { month: "2026-09" } } });
    await w.findAll("button.tab")[1].trigger("click");
    const v = lastEmit(w) as Record<string, unknown>;
    expect(Object.keys(v)).toEqual(["quarter"]);
    expect(v.quarter).toMatch(/^\d{4}-Q[1-4]$/);
    await w.find("select").setValue("2");
    await w.find("select").trigger("change");
    expect((lastEmit(w) as { quarter: string }).quarter).toMatch(/-Q2$/);
  });

  it("ano: emite só { year }", async () => {
    const w = mount(PeriodPicker, { props: { modelValue: { year: "2025" } } });
    const input = w.find('input[aria-label="Ano"]');
    await input.setValue("2024");
    await input.trigger("change");
    expect(lastEmit(w)).toEqual({ year: "2024" });
  });

  it("intervalo: só emite com from e to preenchidos, sem strings vazias", async () => {
    const w = mount(PeriodPicker, { props: { modelValue: { month: "2026-09" } } });
    await w.findAll("button.tab")[3].trigger("click");
    const before = w.emitted("update:modelValue")?.length ?? 0;
    expect(before).toBe(0);
    const [from, to] = w.findAll('input[type="date"]');
    await from.setValue("2026-01-01");
    await from.trigger("change");
    expect(w.emitted("update:modelValue")).toBeUndefined();
    await to.setValue("2026-03-31");
    await to.trigger("change");
    expect(lastEmit(w)).toEqual({ from: "2026-01-01", to: "2026-03-31" });
  });
});

describe("PeriodPicker intervalo invertido", () => {
  it("não emite quando from > to e mostra a dica; volta a emitir ao corrigir", async () => {
    const w = mount(PeriodPicker, { props: { modelValue: { month: "2026-09" } } });
    await w.findAll("button.tab")[3].trigger("click");
    const [from, to] = w.findAll('input[type="date"]');
    await from.setValue("2026-05-10");
    await from.trigger("change");
    await to.setValue("2026-05-01");
    await to.trigger("change");
    expect(w.emitted("update:modelValue")).toBeUndefined();
    expect(w.find(".range-hint").exists()).toBe(true);
    await to.setValue("2026-05-20");
    await to.trigger("change");
    expect(w.find(".range-hint").exists()).toBe(false);
    const ev = w.emitted("update:modelValue")!;
    expect(ev[ev.length - 1][0]).toEqual({ from: "2026-05-10", to: "2026-05-20" });
  });
});

describe("Card", () => {
  it("com `to` renderiza um link do roteador", async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/", component: { template: "<div />" } }, { path: "/transacoes", component: { template: "<div />" } }],
    });
    await router.push("/");
    await router.isReady();
    const w = mount(Card, { props: { title: "Gastos", to: "/transacoes" }, slots: { default: "corpo" }, global: { plugins: [router] } });
    expect(w.element.tagName).toBe("A");
    expect(w.attributes("href")).toBe("/transacoes");
    expect(w.text()).toContain("Gastos");
    expect(w.text()).toContain("corpo");
  });

  it("sem `to` renderiza uma section", () => {
    const w = mount(Card, { props: { title: "Gastos", value: "R$ 1,00", insight: "igual" } });
    expect(w.element.tagName).toBe("SECTION");
    expect(w.text()).toContain("igual");
  });
});

describe("DataTable", () => {
  const columns = [
    { key: "name", label: "Nome" },
    { key: "amount", label: "Valor", align: "right" as const },
  ];

  it("lista vazia mostra o estado vazio e nenhuma tabela", () => {
    const w = mount(DataTable, { props: { columns, rows: [], emptyTitle: "Sem dados", emptyHint: "Tente outro período" } });
    expect(w.find("table").exists()).toBe(false);
    expect(w.text()).toContain("Sem dados");
    expect(w.text()).toContain("Tente outro período");
  });

  it("renderiza linhas, slot por coluna, scope=col e caption", () => {
    const rows = [{ id: "a", name: "Mercado", amount: 1000 }, { id: "b", name: "Padaria", amount: 250 }];
    const w = mount(DataTable, {
      props: { columns, rows, caption: "Gastos do mês", ariaLabel: "Gastos" },
      slots: { "cell-amount": `<template #cell-amount="{ row, value }"><b class="amt">{{ row.name }}:{{ value }}</b></template>` },
    });
    expect(w.findAll("th").every((th) => th.attributes("scope") === "col")).toBe(true);
    expect(w.find("caption").text()).toBe("Gastos do mês");
    expect(w.find("table").attributes("aria-label")).toBe("Gastos");
    expect(w.findAll("tbody tr")).toHaveLength(2);
    expect(w.findAll(".amt").map((e) => e.text())).toEqual(["Mercado:1000", "Padaria:250"]);
    expect(w.findAll("tbody tr")[0].text()).toContain("Mercado");
  });
});

describe("EntityBadge", () => {
  it("mostra a sigla, a classe da entidade e o nome completo no title", () => {
    const pf = mount(EntityBadge, { props: { entity: "pf" } });
    expect(pf.text()).toBe("PF");
    expect(pf.classes()).toContain("pf");
    expect(pf.attributes("title")).toBe("Pessoa Física");
    const pj = mount(EntityBadge, { props: { entity: "pj" } });
    expect(pj.text()).toBe("PJ");
    expect(pj.classes()).toContain("pj");
  });
});
