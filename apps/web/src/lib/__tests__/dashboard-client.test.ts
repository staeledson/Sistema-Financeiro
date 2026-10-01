import { describe, expect, it } from "vitest";
import {
  filterFromQuery, filterToParams, filterToQuery, periodRange, scopeToParams, transactionsLink, type PainelFilter,
} from "../dashboard-client";

const TODAY = "2026-09-15";

describe("filterFromQuery", () => {
  it("query vazia: mês atual e entidade all", () => {
    expect(filterFromQuery({}, TODAY)).toEqual({ entity: "all", accountId: "", month: "2026-09" });
  });

  it("preserva entidade, conta e mês válidos", () => {
    expect(filterFromQuery({ entity: "pj", month: "2026-06", accountId: "x" }, TODAY)).toEqual({
      entity: "pj", accountId: "x", month: "2026-06",
    });
  });

  it("valores inválidos voltam ao padrão", () => {
    expect(filterFromQuery({ month: "2026-13" }, TODAY).month).toBe("2026-09");
    expect(filterFromQuery({ entity: "xx" }, TODAY).entity).toBe("all");
    expect(filterFromQuery({ quarter: "2026-Q5" }, TODAY).month).toBe("2026-09");
    expect(filterFromQuery({ year: "26" }, TODAY).month).toBe("2026-09");
    expect(filterFromQuery({ from: "2026-02-30", to: "2026-03-01" }, TODAY).month).toBe("2026-09");
    expect(filterFromQuery({ from: "2026-03-10", to: "2026-03-01" }, TODAY).month).toBe("2026-09");
    expect(filterFromQuery({ from: "2026-03-01" }, TODAY).month).toBe("2026-09");
  });

  it("mês e ano juntos: o mês vence e só ele é mantido", () => {
    expect(filterFromQuery({ month: "2026-06", year: "2026" }, TODAY)).toEqual({ entity: "all", accountId: "", month: "2026-06" });
  });

  it("mês inválido não esconde um ano válido", () => {
    expect(filterFromQuery({ month: "2026-13", year: "2025" }, TODAY)).toEqual({ entity: "all", accountId: "", year: "2025" });
  });

  it("aceita trimestre, ano e intervalo; usa o primeiro valor de listas", () => {
    expect(filterFromQuery({ quarter: "2026-Q2" }, TODAY).quarter).toBe("2026-Q2");
    expect(filterFromQuery({ year: "2025" }, TODAY).year).toBe("2025");
    expect(filterFromQuery({ from: "2026-03-01", to: "2026-03-31" }, TODAY)).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(filterFromQuery({ month: ["2026-05", "2026-06"] }, TODAY).month).toBe("2026-05");
  });

  it("intervalo acima de 1100 dias é rejeitado (limite da API)", () => {
    expect(filterFromQuery({ from: "2020-01-01", to: "2026-01-01" }, TODAY).month).toBe("2026-09");
  });
});

describe("filterToQuery / filterToParams", () => {
  const base: PainelFilter = { entity: "all", accountId: "", month: "2026-06" };

  it("omite vazios e entity=all", () => {
    expect(filterToQuery(base)).toEqual({ month: "2026-06" });
    expect(filterToQuery({ ...base, entity: "pf", accountId: "a1" })).toEqual({ entity: "pf", accountId: "a1", month: "2026-06" });
  });

  it("envia um único tipo de período e nunca valores vazios", () => {
    const f: PainelFilter = { entity: "all", accountId: "", month: "2026-06", year: "2026", from: "", to: "" };
    expect(filterToQuery(f)).toEqual({ month: "2026-06" });
    const range = filterToQuery({ entity: "all", accountId: "", from: "2026-01-01", to: "2026-02-01" });
    expect(range).toEqual({ from: "2026-01-01", to: "2026-02-01" });
    expect(filterToParams({ entity: "all", accountId: "", from: "", to: "" }).toString()).toBe("");
  });

  it("serializa com os nomes de parâmetro da API", () => {
    const p = filterToParams({ entity: "pj", accountId: "a1", quarter: "2026-Q2" });
    expect(p.get("entity")).toBe("pj");
    expect(p.get("accountId")).toBe("a1");
    expect(p.get("quarter")).toBe("2026-Q2");
    expect(p.has("asOf")).toBe(false);
  });

  it("scopeToParams leva só entidade e conta", () => {
    expect(scopeToParams({ entity: "pf", accountId: "a1", month: "2026-06" }).toString()).toBe("entity=pf&accountId=a1");
    expect(scopeToParams(base).toString()).toBe("");
  });
});

describe("transactionsLink", () => {
  it("mês: primeiro e último dia, com a categoria", () => {
    const l = transactionsLink({ entity: "all", accountId: "", month: "2026-06" }, { categoryId: "c1" });
    expect(l).toEqual({ path: "/transacoes", query: { from: "2026-06-01", to: "2026-06-30", categoryId: "c1" } });
  });

  it("fevereiro em ano bissexto", () => {
    expect(transactionsLink({ entity: "all", accountId: "", month: "2028-02" }).query).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("trimestre e ano", () => {
    expect(transactionsLink({ entity: "all", accountId: "", quarter: "2026-Q2" }).query).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(transactionsLink({ entity: "all", accountId: "", quarter: "2026-Q4" }).query).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(transactionsLink({ entity: "all", accountId: "", year: "2026" }).query).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("intervalo é repassado e extra.from/to têm prioridade", () => {
    const f: PainelFilter = { entity: "all", accountId: "", from: "2026-03-05", to: "2026-04-10" };
    expect(transactionsLink(f).query).toEqual({ from: "2026-03-05", to: "2026-04-10" });
    expect(transactionsLink(f, { from: "2026-03-10", to: "2026-03-12" }).query).toEqual({ from: "2026-03-10", to: "2026-03-12" });
  });

  it("entidade e conta entram na query", () => {
    const l = transactionsLink({ entity: "pj", accountId: "a9", month: "2026-06" });
    expect(l.query).toEqual({ from: "2026-06-01", to: "2026-06-30", entity: "pj", accountId: "a9" });
  });
});

describe("periodRange", () => {
  it("sem período usa o mês de today", () => {
    expect(periodRange({ entity: "all", accountId: "" }, "2026-09-15")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});
