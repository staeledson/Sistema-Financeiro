/**
 * Espelha `pendingReviewWhere` da API (a fila "Para categorizar"): receita/despesa não pareada e não ignorada que está
 * `pending` ou que ficou "esquecida" (sem categoria nenhuma, fora da fila há mais de 15 minutos).
 */

const FORGOTTEN_AFTER_MS = 15 * 60_000;

export interface ReviewQueueRow {
  type: "income" | "expense" | "transfer";
  ignored: boolean;
  transferPairId: string | null;
  reviewStatus: "ok" | "pending";
  categoryId: string | null;
  categorySource: string;
  createdAt: string;
}

export function isPendingReview(tx: ReviewQueueRow, now: number = Date.now()): boolean {
  if (tx.ignored || tx.transferPairId || tx.type === "transfer") return false;
  if (tx.reviewStatus === "pending") return true;
  const created = Date.parse(tx.createdAt);
  return !tx.categoryId && tx.categorySource === "none" && Number.isFinite(created) && created < now - FORGOTTEN_AFTER_MS;
}
