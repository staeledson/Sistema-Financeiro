import { http } from "./http";
import type { AccountEntity, CategoryEntity, Institution } from "./entity";

function req<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  return http<T>(method, path, body);
}

export type AccountType = "checking" | "savings" | "credit_card" | "cash" | "investment";
export type CategoryType = "income" | "expense";
export type TransactionType = "income" | "expense" | "transfer";
export type CategorySource = "none" | "manual" | "rule" | "ai" | "import";
export type ReviewStatus = "ok" | "pending";

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

/** Resposta de `POST /accounts/:id/reconcile` (centavos). */
export interface ReconcileResult {
  accountId: string;
  previousBalanceCents: number;
  newBalanceCents: number;
  adjustmentCents: number;
  openingBalanceCents: number;
}

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
  /** Mesmo id nos dois lados de uma transferência pareada; `null` fora de par. */
  transferPairId: string | null;
  ignored: boolean;
  categorySource: CategorySource;
  reviewStatus: ReviewStatus;
  /** ISO; a fila "Para categorizar" usa para achar linhas esquecidas. */
  createdAt: string;
  installmentCurrent: number | null;
  installmentTotal: number | null;
}

/** O que `POST /transactions` devolve: sem os campos de par, revisão e criação (recarregue a lista para tê-los). */
export type CreatedTransaction = Omit<Transaction, "transferPairId" | "ignored" | "categorySource" | "reviewStatus" | "createdAt">;

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

// --- Dashboards (Fase 13) ---------------------------------------------------

export type DashboardEntity = "all" | "pf" | "pj";

export interface DashboardPeriod {
  kind: "month" | "quarter" | "year" | "range";
  from: string;
  to: string;
  label: string;
}

export interface SpendingCategory {
  /** `"__none"` para despesas sem categoria. */
  categoryId: string;
  name: string;
  totalCents: number;
  previousCents: number;
  pct: number;
  count: number;
}

export interface SpendingSeries {
  key: string;
  categoryId: string | null;
  name: string;
  totalsCents: number[];
}

export interface BudgetUsage {
  categoryId: string;
  name: string;
  limitCents: number;
  spentCents: number;
  pct: number;
}

export interface Counterparty {
  name: string;
  totalCents: number;
  count: number;
}

export interface RecurringGroup {
  key: string;
  label: string;
  frequency: "monthly" | "weekly";
  avgCents: number;
  intervalDays: number;
  occurrences: number;
  monthlyEstimateCents: number;
  lastDate: string;
}

export interface SpendingByMonth {
  months: string[];
  series: SpendingSeries[];
}

export interface SpendingDashboard {
  period: DashboardPeriod;
  previousPeriod: DashboardPeriod;
  totalCents: number;
  previousTotalCents: number;
  insight: string | null;
  byCategory: SpendingCategory[];
  byMonth: SpendingByMonth;
  vsBudget: BudgetUsage[];
  topCounterparties: Counterparty[];
  recurring: RecurringGroup[];
}

export type InvoiceStatus = "paid" | "partial" | "open" | "overdue";

export interface CardCycleDay {
  day: number;
  /** `null` nos dias do ciclo que ainda não chegaram. */
  currentCents: number | null;
  avgPreviousCents: number;
}

export interface CardInstallmentMonth {
  /** Mês de vencimento da fatura (YYYY-MM). */
  month: string;
  amountCents: number;
  count: number;
}

export interface CardInvoicePayment {
  closing: string;
  due: string;
  invoiceCents: number;
  paidCents: number;
  status: InvoiceStatus;
}

export interface CardDashboard {
  accountId: string;
  name: string;
  entity: AccountEntity;
  configured: boolean;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: number | null;
  usedCents: number;
  limitUsedPct: number | null;
  openInvoiceCents: number | null;
  closingDate: string | null;
  dueDate: string | null;
  cycleDaily: CardCycleDay[];
  installmentsAhead: CardInstallmentMonth[];
  invoicePayments: CardInvoicePayment[];
}

export interface CardsDashboard {
  cards: CardDashboard[];
}

export interface CashflowAccountBalance {
  accountId: string;
  name: string;
  type: AccountType;
  entity: AccountEntity;
  balanceCents: number;
}

export interface ConsolidatedBalance {
  pfCents: number;
  pjCents: number;
  totalCents: number;
}

export interface CashflowMonth {
  month: string;
  incomeCents: number;
  expenseCents: number;
  transfersNetCents: number;
  balanceCents: number;
}

export interface ForecastMonth {
  month: string;
  incomeCents: number;
  variableCents: number;
  recurringCents: number;
  billsCents: number;
  installmentsCents: number;
  expenseCents: number;
  balanceCents: number;
}

export interface CashflowDashboard {
  balances: { accounts: CashflowAccountBalance[]; consolidated: ConsolidatedBalance };
  monthly: CashflowMonth[];
  forecast: ForecastMonth[];
}

export interface SummaryDashboard {
  balances: ConsolidatedBalance;
  pendingCount: number;
  nextInvoice: { accountId: string; name: string; dueDate: string; openInvoiceCents: number } | null;
  spending: {
    totalCents: number;
    insight: string | null;
    byCategory: SpendingCategory[];
    byMonth: SpendingByMonth;
    vsBudget: BudgetUsage[];
  };
}

export interface WorkspaceSettings {
  aiConfidenceThreshold: number;
  aiBatchSize: number;
  transferMatchWindowDays: number;
  ownerNames: string[];
}

function dashboardPath(name: string, params?: URLSearchParams): string {
  const qs = params?.toString();
  return `/dashboard/${name}${qs ? `?${qs}` : ""}`;
}

export const api = {
  accounts: {
    list: (entity?: AccountEntity) => req<BankAccount[]>("GET", `/accounts${entity ? `?entity=${entity}` : ""}`),
    create: (body: NewAccount) => req<BankAccount>("POST", "/accounts", body),
    update: (id: string, body: UpdateAccount) => req<BankAccount>("PATCH", `/accounts/${id}`, body),
    reconcile: (id: string, balanceCents: number) => req<ReconcileResult>("POST", `/accounts/${id}/reconcile`, { balanceCents }),
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
    list: (params?: {
      from?: string; to?: string; accountId?: string; categoryId?: string; q?: string; entity?: AccountEntity;
      type?: TransactionType; reportable?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.accountId) qs.set("accountId", params.accountId);
      if (params?.categoryId) qs.set("categoryId", params.categoryId);
      if (params?.q) qs.set("q", params.q);
      if (params?.entity) qs.set("entity", params.entity);
      if (params?.type) qs.set("type", params.type);
      if (params?.reportable) qs.set("reportable", "1");
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
    }) => req<CreatedTransaction>("POST", "/transactions", body),
  },
  balances: {
    get: () => req<Balances>("GET", "/balances"),
  },
  dashboard: {
    spending: (params: URLSearchParams) => req<SpendingDashboard>("GET", dashboardPath("spending", params)),
    cards: (params: URLSearchParams) => req<CardsDashboard>("GET", dashboardPath("cards", params)),
    cashflow: (params: URLSearchParams) => req<CashflowDashboard>("GET", dashboardPath("cashflow", params)),
  },
  /** Resumo do Início: sempre o workspace inteiro; só `asOf` (YYYY-MM-DD) tem efeito. */
  summary: (asOf?: string) => req<SummaryDashboard>("GET", dashboardPath("summary", asOf ? new URLSearchParams({ asOf }) : undefined)),
  review: {
    unpair: (transferPairId: string) => req<{ unpaired: number }>("POST", "/review/unpair", { transferPairId }),
    ignore: (transactionIds: string[]) => req<{ ignored: number }>("POST", "/review/ignore", { transactionIds }),
    unignore: (transactionIds: string[]) => req<{ unignored: number }>("POST", "/review/unignore", { transactionIds }),
  },
  settings: {
    get: () => req<WorkspaceSettings>("GET", "/workspaces/current/settings"),
    update: (body: Partial<WorkspaceSettings>) => req<WorkspaceSettings>("PATCH", "/workspaces/current/settings", body),
  },
};
