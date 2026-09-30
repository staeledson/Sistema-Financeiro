import type { AccountType, BankAccount, NewAccount, UpdateAccount } from "./api";
import type { AccountEntity, Institution } from "./entity";

export interface AccountFormState {
  name: string;
  type: AccountType;
  entity: AccountEntity;
  institution: Institution;
  externalId: string;
  openingBalanceReais: number;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitReais: number | null;
}

export function emptyAccountForm(): AccountFormState {
  return {
    name: "",
    type: "checking",
    entity: "pf",
    institution: "other",
    externalId: "",
    openingBalanceReais: 0,
    closingDay: null,
    dueDay: null,
    creditLimitReais: null,
  };
}

export function formFromAccount(acc: BankAccount): AccountFormState {
  return {
    name: acc.name,
    type: acc.type,
    entity: acc.entity,
    institution: acc.institution,
    externalId: acc.externalId ?? "",
    openingBalanceReais: acc.openingBalanceCents / 100,
    closingDay: acc.closingDay,
    dueDay: acc.dueDay,
    creditLimitReais: acc.creditLimitCents == null ? null : acc.creditLimitCents / 100,
  };
}

/** `v-model.number` deixa string vazia quando o campo é apagado; isso vira null. */
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function reaisToCents(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n * 100);
}

function cardFields(f: AccountFormState) {
  return {
    closingDay: numOrNull(f.closingDay),
    dueDay: numOrNull(f.dueDay),
    creditLimitCents: reaisToCents(f.creditLimitReais),
  };
}

export function buildCreateAccountPayload(f: AccountFormState): NewAccount {
  return {
    type: f.type,
    name: f.name.trim(),
    openingBalanceCents: Math.round(f.openingBalanceReais * 100),
    entity: f.entity,
    institution: f.institution,
    externalId: f.externalId.trim() || null,
    ...(f.type === "credit_card" ? cardFields(f) : {}),
  };
}

export function buildUpdateAccountPayload(f: AccountFormState): UpdateAccount {
  return {
    name: f.name.trim(),
    entity: f.entity,
    institution: f.institution,
    externalId: f.externalId.trim() || null,
    ...(f.type === "credit_card" ? cardFields(f) : {}),
  };
}
