import { http } from "./http";
import type { AccountEntity, CategoryEntity, Institution } from "./entity";

function req<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  return http<T>(method, path, body);
}

export type AccountType = "checking" | "savings" | "credit_card" | "cash" | "investment";
export type CategoryType = "income" | "expense";
export type TransactionType = "income" | "expense" | "transfer";

export interface BankAccount {
  id: string;
  type: AccountType;
  name: string;
  openingBalanceCents: number;
  archived: boolean;
  entity: AccountEntity;
  institution: Institution;
  externalId: string | null;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: number | null;
}

export interface NewAccount {
  type: AccountType;
  name: string;
  openingBalanceCents?: number;
  entity?: AccountEntity;
  institution?: Institution;
  externalId?: string | null;
  closingDay?: number | null;
  dueDay?: number | null;
  creditLimitCents?: number | null;
}

export type UpdateAccount = Partial<Omit<NewAccount, "type" | "openingBalanceCents">>;

export interface Category {
  id: string;
  type: CategoryType;
  name: string;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  entity: CategoryEntity;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  amountCents: number;
  date: string;
  accountId: string | null;
  sourceAccountId: string | null;
  destAccountId: string | null;
  categoryId: string | null;
  description: string | null;
  counterparty: string | null;
}

export interface AccountBalance {
  accountId: string;
  name: string;
  type: AccountType;
  balanceCents: number;
}

export interface Balances {
  accounts: AccountBalance[];
  consolidatedCents: number;
}

export interface Dashboard {
  cashflow: { incomeCents: number; expenseCents: number };
  expenseBreakdown: { categoryId: string | null; name: string; totalCents: number }[];
  cashflowSeries: { month: string; incomeCents: number; expenseCents: number }[];
}

export const api = {
  accounts: {
    list: (entity?: AccountEntity) => req<BankAccount[]>("GET", `/accounts${entity ? `?entity=${entity}` : ""}`),
    create: (body: NewAccount) => req<BankAccount>("POST", "/accounts", body),
    update: (id: string, body: UpdateAccount) => req<BankAccount>("PATCH", `/accounts/${id}`, body),
    archive: (id: string) => req<{ ok: boolean }>("PATCH", `/accounts/${id}/archive`),
  },
  categories: {
    list: (type?: CategoryType, entity?: AccountEntity) => {
      const qs = new URLSearchParams();
      if (type) qs.set("type", type);
      if (entity) qs.set("entity", entity);
      const s = qs.toString();
      return req<Category[]>("GET", `/categories${s ? `?${s}` : ""}`);
    },
  },
  transactions: {
    list: (params?: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string; entity?: AccountEntity }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.accountId) qs.set("accountId", params.accountId);
      if (params?.categoryId) qs.set("categoryId", params.categoryId);
      if (params?.q) qs.set("q", params.q);
      if (params?.entity) qs.set("entity", params.entity);
      const s = qs.toString();
      return req<Transaction[]>("GET", `/transactions${s ? `?${s}` : ""}`);
    },
    create: (body: {
      type: TransactionType;
      amountCents: number;
      date: string;
      accountId?: string | null;
      sourceAccountId?: string | null;
      destAccountId?: string | null;
      categoryId?: string | null;
      description?: string | null;
    }) => req<Transaction>("POST", "/transactions", body),
  },
  balances: {
    get: () => req<Balances>("GET", "/balances"),
  },
  dashboard: {
    get: (month: string) => req<Dashboard>("GET", `/dashboard?month=${month}`),
  },
};
