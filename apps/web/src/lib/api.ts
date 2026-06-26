import { useAuthStore } from "../stores/auth";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = { authorization: `Bearer ${auth.token ?? ""}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res.json() as Promise<T>;
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
}

export interface Category {
  id: string;
  type: CategoryType;
  name: string;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
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
  expenseBreakdown: { categoryId: string; _sum: { amountCents: number } }[];
  cashflowSeries: { month: string; incomeCents: number; expenseCents: number }[];
}

export const api = {
  accounts: {
    list: () => req<BankAccount[]>("GET", "/accounts"),
    create: (body: { type: AccountType; name: string; openingBalanceCents?: number }) =>
      req<BankAccount>("POST", "/accounts", body),
    archive: (id: string) => req<{ ok: boolean }>("PATCH", `/accounts/${id}/archive`),
  },
  categories: {
    list: (type?: CategoryType) =>
      req<Category[]>("GET", `/categories${type ? `?type=${type}` : ""}`),
  },
  transactions: {
    list: (params?: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.accountId) qs.set("accountId", params.accountId);
      if (params?.categoryId) qs.set("categoryId", params.categoryId);
      if (params?.q) qs.set("q", params.q);
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
