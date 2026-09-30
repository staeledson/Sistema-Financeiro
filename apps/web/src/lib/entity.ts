import type { AccountType } from "./api";

export type AccountEntity = "pf" | "pj";
export type EntityFilter = AccountEntity | "all";
export type Institution = "bb" | "inter" | "mercado_pago" | "c6" | "other";
export type CategoryEntity = AccountEntity | "both";

export const ENTITY_LABEL: Record<AccountEntity, string> = {
  pf: "Pessoa Física",
  pj: "Pessoa Jurídica",
};

export const ENTITY_SHORT: Record<AccountEntity, string> = { pf: "PF", pj: "PJ" };

export const INSTITUTION_LABEL: Record<Institution, string> = {
  bb: "Banco do Brasil",
  inter: "Inter",
  mercado_pago: "Mercado Pago",
  c6: "C6 Bank",
  other: "Outra",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
  investment: "Investimento",
};

export function accountsForEntity<T extends { entity: AccountEntity }>(accounts: T[], filter: EntityFilter): T[] {
  return filter === "all" ? accounts : accounts.filter((a) => a.entity === filter);
}

/** Categorias `both` valem para qualquer entidade; sem entidade, nada é filtrado. */
export function categoriesForEntity<T extends { entity: CategoryEntity }>(
  categories: T[],
  entity: AccountEntity | null | undefined,
): T[] {
  return entity ? categories.filter((c) => c.entity === "both" || c.entity === entity) : categories;
}
