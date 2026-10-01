import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import Money from "../Money.vue";
import PeriodPicker from "../PeriodPicker.vue";

describe("Money", () => {
  it("formata em reais e colore pelo sinal", () => {
    const w = mount(Money, { props: { cents: -1234, colored: true } });
    expect(w.text()).toContain("12,34");
    expect(w.classes()).toContain("neg");
  });

  it("sem colored não aplica classe de sinal; compact abrevia", () => {
    const w = mount(Money, { props: { cents: 120_000_00, compact: true } });
    expect(w.text()).toBe("R$ 120 mil");
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
