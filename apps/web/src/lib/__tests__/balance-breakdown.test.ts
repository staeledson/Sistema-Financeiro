import { describe, expect, it } from "vitest";
import { breakdownFor } from "../balance-breakdown";
import type { SummaryAccount } from "../api";

const acc = (accountId: string, entity: "pf" | "pj", type: SummaryAccount["type"], balanceCents: number, extra: Partial<SummaryAccount> = {}): SummaryAccount => ({
  accountId, name: accountId, type, entity, institution: "other", balanceCents, closingDay: null, dueDay: null, ...extra,
});

const accounts: SummaryAccount[] = [
  acc("pf-pequena", "pf", "checking", 1000),
  acc("pf-grande", "pf", "savings", 200000),
  acc("pf-zero", "pf", "cash", 0),
  acc("pf-negativa", "pf", "checking", -5000),
  acc("pj-conta", "pj", "checking", 30000),
  acc("pf-cartao", "pf", "credit_card", -63113, { closingDay: 10, dueDay: 17 }),
  acc("pj-cartao", "pj", "credit_card", -1000),
];

describe("breakdownFor", () => {
  it("pf: só contas de caixa da PF, ordenadas pelo valor absoluto (maior primeiro), zeradas incluídas", () => {
    const b = breakdownFor("pf", accounts);
    expect(b.title).toBe("Pessoa Física");
    expect(b.groups).toHaveLength(1);
    expect(b.groups[0]).toMatchObject({ label: "Pessoa Física", entity: "pf" });
    expect(b.groups[0].accounts.map((a) => a.accountId)).toEqual(["pf-grande", "pf-negativa", "pf-pequena", "pf-zero"]);
    expect(b.groups[0].subtotalCents).toBe(196000);
    expect(b.totalCents).toBe(196000);
  });

  it("pj: só a PJ, sem cartões", () => {
    const b = breakdownFor("pj", accounts);
    expect(b.title).toBe("Pessoa Jurídica");
    expect(b.groups.map((g) => g.accounts.map((a) => a.accountId))).toEqual([["pj-conta"]]);
    expect(b.totalCents).toBe(30000);
  });

  it("total: dois grupos (PF e PJ) com subtotais que somam o total, sem cartões", () => {
    const b = breakdownFor("total", accounts);
    expect(b.title).toBe("Saldo total em contas");
    expect(b.groups.map((g) => [g.label, g.entity, g.subtotalCents])).toEqual([
      ["Pessoa Física", "pf", 196000],
      ["Pessoa Jurídica", "pj", 30000],
    ]);
    expect(b.totalCents).toBe(226000);
    expect(b.totalCents).toBe(b.groups.reduce((s, g) => s + g.subtotalCents, 0));
    expect(b.groups.flatMap((g) => g.accounts).some((a) => a.type === "credit_card")).toBe(false);
  });

  it("grupo sem contas fica oculto", () => {
    const onlyPf = accounts.filter((a) => a.entity === "pf");
    expect(breakdownFor("total", onlyPf).groups.map((g) => g.entity)).toEqual(["pf"]);
    expect(breakdownFor("pj", onlyPf).groups).toEqual([]);
    expect(breakdownFor("pj", onlyPf).totalCents).toBe(0);
    expect(breakdownFor("cards", accounts.filter((a) => a.type !== "credit_card")).groups).toEqual([]);
  });

  it("cartões: só cartões, saldo negativo (dívida), agrupados por entidade", () => {
    const b = breakdownFor("cards", accounts);
    expect(b.title).toBe("Cartões a pagar");
    expect(b.groups.map((g) => [g.entity, g.subtotalCents, g.accounts.map((a) => a.accountId)])).toEqual([
      ["pf", -63113, ["pf-cartao"]],
      ["pj", -1000, ["pj-cartao"]],
    ]);
    expect(b.totalCents).toBe(-64113);
    expect(b.groups.flatMap((g) => g.accounts).every((a) => a.balanceCents < 0)).toBe(true);
  });

  it("empate no valor absoluto desempata pelo nome", () => {
    const b = breakdownFor("pf", [acc("b", "pf", "checking", 100), acc("a", "pf", "checking", -100)]);
    expect(b.groups[0].accounts.map((a) => a.accountId)).toEqual(["a", "b"]);
  });
});
