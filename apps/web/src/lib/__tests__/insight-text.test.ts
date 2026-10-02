import { describe, expect, it } from "vitest";
import { insightDetail, insightIcon, insightTitle } from "../insight-text";

describe("insight-text", () => {
  it("conta a vencer", () => {
    const ins = { type: "bill_due", payload: { name: "Luz", amountCents: 12050, dueDate: "2026-10-05" } };
    expect(insightTitle(ins)).toBe("Conta a vencer: Luz");
    expect(insightDetail(ins)).toBe("R$ 120,50 vence em 05/10/2026");
    expect(insightIcon("bill_due")).toBe("📅");
  });
  it("previsão positiva e negativa", () => {
    expect(insightTitle({ type: "forecast", payload: { forecastBalanceCents: 100 } })).toBe("Previsão positiva este mês");
    expect(insightTitle({ type: "forecast", payload: { forecastBalanceCents: -100 } })).toBe("Atenção: déficit previsto");
    expect(insightDetail({ type: "forecast", payload: { forecastBalanceCents: -1500, narrative: null } })).toBe("Previsão: R$ 15,00");
  });
  it("tipo desconhecido não quebra", () => {
    expect(insightTitle({ type: "x", payload: {} })).toBe("x");
    expect(insightDetail({ type: "x", payload: {} })).toBe("");
  });
});
