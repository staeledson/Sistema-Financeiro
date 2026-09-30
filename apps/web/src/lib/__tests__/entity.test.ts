import { describe, it, expect } from "vitest";
import { accountsForEntity, categoriesForEntity, ENTITY_SHORT, ENTITY_LABEL, INSTITUTION_LABEL } from "../entity";

const accounts = [
  { id: "1", entity: "pf" as const },
  { id: "2", entity: "pj" as const },
  { id: "3", entity: "pf" as const },
];

const categories = [
  { id: "a", entity: "both" as const },
  { id: "b", entity: "pj" as const },
  { id: "c", entity: "pf" as const },
];

describe("accountsForEntity", () => {
  it("all devolve todas", () => {
    expect(accountsForEntity(accounts, "all").map((a) => a.id)).toEqual(["1", "2", "3"]);
  });
  it("pf e pj filtram", () => {
    expect(accountsForEntity(accounts, "pf").map((a) => a.id)).toEqual(["1", "3"]);
    expect(accountsForEntity(accounts, "pj").map((a) => a.id)).toEqual(["2"]);
  });
});

describe("categoriesForEntity", () => {
  it("sem entidade devolve todas", () => {
    expect(categoriesForEntity(categories, undefined).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("pj devolve pj e both; pf devolve pf e both", () => {
    expect(categoriesForEntity(categories, "pj").map((c) => c.id)).toEqual(["a", "b"]);
    expect(categoriesForEntity(categories, "pf").map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("rótulos", () => {
  it("cobrem todas as entidades e instituições", () => {
    expect(ENTITY_SHORT).toEqual({ pf: "PF", pj: "PJ" });
    expect(ENTITY_LABEL.pj).toBe("Pessoa Jurídica");
    expect(Object.keys(INSTITUTION_LABEL).sort()).toEqual(["bb", "c6", "inter", "mercado_pago", "other"]);
  });
});
