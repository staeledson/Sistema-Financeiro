import { http } from "./http";
import { categoriesForEntity, type AccountEntity, type CategoryEntity } from "./entity";

export interface PendingGroup {
  key: string;
  type: "income" | "expense";
  description: string;
  count: number;
  totalCents: number;
  entity: AccountEntity | null;
  suggestedCategoryId: string | null;
  transactionIds: string[];
}

export interface PendingResponse {
  total: number;
  groups: PendingGroup[];
}

export interface TransferCandidate {
  id: string;
  date: string;
  amountCents: number;
  description: string | null;
  accountName: string | null;
}

export interface RuleRow {
  id: string;
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  categoryId: string;
  priority: number;
  hitCount: number;
}

export function getPending(params: { entity?: AccountEntity; accountId?: string }) {
  const qs = new URLSearchParams();
  if (params.entity) qs.set("entity", params.entity);
  if (params.accountId) qs.set("accountId", params.accountId);
  const s = qs.toString();
  return http<PendingResponse>("GET", `/review/pending${s ? `?${s}` : ""}`);
}

export function categorizeGroup(body: { transactionIds: string[]; categoryId: string; createRule?: boolean; applyToSimilar?: boolean }) {
  return http<{ updated: number; similarUpdated: number; ruleCreated: boolean }>("POST", "/review/categorize", body);
}

export function acceptSuggestions(transactionIds: string[]) {
  return http<{ accepted: number; skipped: number }>("POST", "/review/accept-suggestion", { transactionIds });
}

export function ignoreTransactions(transactionIds: string[]) {
  return http<{ ignored: number }>("POST", "/review/ignore", { transactionIds });
}

export function markTransfer(transactionId: string, counterpartTransactionId: string) {
  return http<{ transferPairId: string }>("POST", "/review/mark-transfer", { transactionId, counterpartTransactionId });
}

export function getTransferCandidates(transactionId: string) {
  return http<TransferCandidate[]>("GET", `/review/transfer-candidates?transactionId=${encodeURIComponent(transactionId)}`);
}

export function recategorize() {
  return http<{ id: string }>("POST", "/review/recategorize", {});
}

export function listRules() {
  return http<RuleRow[]>("GET", "/category-rules");
}

export function deleteRule(id: string) {
  return http<void>("DELETE", `/category-rules/${id}`);
}

/** Categorias oferecidas a um grupo: do tipo do grupo e, se o grupo é de uma só entidade, compatíveis com ela. */
export function categoriesForGroup<T extends { type: "income" | "expense"; entity: CategoryEntity }>(
  categories: T[],
  group: { type: "income" | "expense"; entity: AccountEntity | null },
): T[] {
  return categoriesForEntity(categories.filter((c) => c.type === group.type), group.entity);
}
