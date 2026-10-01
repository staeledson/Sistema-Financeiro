import { describe, it, expect } from "vitest";
import { cycleClosingIn, cycleOf, recentCycles, parseInstallment } from "../cards";

describe("ciclo de fatura", () => {
  it("fecha dia 10, vence dia 17 do mesmo mês", () => {
    expect(cycleClosingIn("2026-06", 10, 17)).toEqual({ ym: "2026-06", start: "2026-05-11", closing: "2026-06-10", due: "2026-06-17" });
  });
  it("vencimento antes do fechamento cai no mês seguinte", () => {
    expect(cycleClosingIn("2026-06", 25, 5)).toEqual({ ym: "2026-06", start: "2026-05-26", closing: "2026-06-25", due: "2026-07-05" });
  });
  it("dia 31 é limitado ao último dia do mês", () => {
    expect(cycleClosingIn("2026-02", 31, 10)).toMatchObject({ start: "2026-02-01", closing: "2026-02-28" });
    expect(cycleClosingIn("2026-03", 31, 10)).toMatchObject({ start: "2026-03-01", closing: "2026-03-31" });
  });
  it("compra no dia do fechamento fica na fatura que fecha; no dia seguinte vai para a próxima", () => {
    expect(cycleOf("2026-06-10", 10, 17).ym).toBe("2026-06");
    expect(cycleOf("2026-06-11", 10, 17)).toMatchObject({ ym: "2026-07", start: "2026-06-11", closing: "2026-07-10" });
  });
  it("virada de ano", () => {
    expect(cycleOf("2026-12-20", 10, 17)).toMatchObject({ ym: "2027-01", closing: "2027-01-10" });
  });
  it("recentCycles devolve a aberta e as fechadas em ordem cronológica", () => {
    const r = recentCycles("2026-06-20", 10, 17, 3);
    expect(r.open.ym).toBe("2026-07");
    expect(r.closed.map((c) => c.ym)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});

describe("parseInstallment", () => {
  it("lê n/m na descrição", () => {
    expect(parseInstallment("LOJA X 03/10")).toEqual({ current: 3, total: 10 });
    expect(parseInstallment("Parcela 2/12 Amazon")).toEqual({ current: 2, total: 12 });
  });
  it("ignora datas, mês/ano, total 1 e parcela maior que o total", () => {
    expect(parseInstallment("PAGAMENTO 12/03/2026")).toBeNull();
    expect(parseInstallment("Netflix 01/2026")).toBeNull();
    expect(parseInstallment("COMPRA 5/1")).toBeNull();
    expect(parseInstallment("AMAZON 13/12")).toBeNull();
    expect(parseInstallment("")).toBeNull();
  });
});
