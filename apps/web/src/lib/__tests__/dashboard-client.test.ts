import { describe, expect, it } from "vitest";
import {
  cardCycleLink, categoryLink, cycleStart, expensesMonthLink, filterFromQuery, filterToParams, filterToQuery, isValidRange, localToday,
  monthLink, monthRange, periodRange, rangeError, scopeToParams, transactionsLink, type PainelFilter,
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
    expect(filterToParams({ entity: "all", accountId: "", from: "", to: "" }, "2026-09-15").toString()).toBe("asOf=2026-09-15");
  });

  it("serializa com os nomes de parâmetro da API", () => {
    const p = filterToParams({ entity: "pj", accountId: "a1", quarter: "2026-Q2" }, "2026-09-15");
    expect(p.get("entity")).toBe("pj");
    expect(p.get("accountId")).toBe("a1");
    expect(p.get("quarter")).toBe("2026-Q2");
    expect(p.get("asOf")).toBe("2026-09-15");
    expect(p.toString()).toBe("entity=pj&accountId=a1&quarter=2026-Q2&asOf=2026-09-15");
  });

  it("scopeToParams leva só entidade, conta e asOf", () => {
    expect(scopeToParams({ entity: "pf", accountId: "a1", month: "2026-06" }, "2026-09-15").toString()).toBe("entity=pf&accountId=a1&asOf=2026-09-15");
    expect(scopeToParams(base, "2026-09-15").toString()).toBe("asOf=2026-09-15");
  });

  it("asOf padrão é a data local do navegador, não a UTC", () => {
    expect(filterToParams(base).get("asOf")).toBe(localToday());
    expect(scopeToParams(base).get("asOf")).toBe(localToday());
    // 23:30 do dia 15 no fuso local, mesmo que em UTC já seja dia 16
    expect(localToday(new Date(2026, 8, 15, 23, 30))).toBe("2026-09-15");
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

describe("builders de link dos gráficos", () => {
  const f: PainelFilter = { entity: "pj", accountId: "a9", month: "2026-06" };

  it("categoryLink: período do filtro, tipo despesa e reportable", () => {
    expect(categoryLink(f, "c1")).toEqual({
      path: "/transacoes",
      query: { from: "2026-06-01", to: "2026-06-30", entity: "pj", accountId: "a9", categoryId: "c1", type: "expense", reportable: "1" },
    });
  });

  it("categoryLink de 'Sem categoria' leva __none; com mês usa o mês do ponto clicado", () => {
    const l = categoryLink({ entity: "all", accountId: "", year: "2026" }, "__none", "2026-02");
    expect(l.query).toEqual({ from: "2026-02-01", to: "2026-02-28", categoryId: "__none", type: "expense", reportable: "1" });
  });

  it("expensesMonthLink não leva categoria", () => {
    const q = expensesMonthLink({ entity: "all", accountId: "", month: "2026-06" }, "2026-03").query;
    expect(q).toEqual({ from: "2026-03-01", to: "2026-03-31", type: "expense", reportable: "1" });
  });

  it("monthLink: só o mês e o escopo, sem tipo", () => {
    expect(monthLink(f, "2026-05").query).toEqual({ from: "2026-05-01", to: "2026-05-31", entity: "pj", accountId: "a9" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("cycleStart: dia seguinte ao fechamento anterior, com virada de ano e dia limitado ao fim do mês", () => {
    expect(cycleStart("2026-06-20", 20)).toBe("2026-05-21");
    expect(cycleStart("2026-01-10", 10)).toBe("2025-12-11");
    expect(cycleStart("2026-03-31", 31)).toBe("2026-03-01"); // fev fecha dia 28
    expect(cycleStart("2026-06-30", 31)).toBe("2026-06-01"); // mai fecha dia 31
  });

  it("cardCycleLink: ciclo atual da conta do cartão, sem entidade", () => {
    expect(cardCycleLink({ accountId: "k1", closingDate: "2026-06-20", closingDay: 20 })).toEqual({
      path: "/transacoes",
      query: { from: "2026-05-21", to: "2026-06-20", accountId: "k1" },
    });
  });
});

describe("rangeError / isValidRange", () => {
  it("ordem, limite de 1100 dias e incompleto", () => {
    expect(rangeError("2026-05-10", "2026-05-01")).toBe("order");
    expect(rangeError("2020-01-01", "2026-01-01")).toBe("too-long");
    expect(rangeError("2023-01-01", "2026-01-05")).toBeNull(); // exatamente 1100 dias
    expect(rangeError("2023-01-01", "2026-01-06")).toBe("too-long");
    expect(rangeError("2026-01-01", "2026-03-01")).toBeNull();
    expect(rangeError("", "2026-03-01")).toBeNull();
    expect(isValidRange("2026-01-01", "2026-03-01")).toBe(true);
    expect(isValidRange("2026-01-01", "")).toBe(false);
    expect(isValidRange("2020-01-01", "2026-01-01")).toBe(false);
  });
});
