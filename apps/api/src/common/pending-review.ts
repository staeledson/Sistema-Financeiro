import type { Prisma } from "../../generated/prisma/client";
import type { AccountEntity } from "@app/shared";

const FORGOTTEN_AFTER_MS = 15 * 60_000;

/**
 * Lançamentos da fila "Para categorizar": pendentes + "esquecidas" (sem categoria nenhuma e fora da fila há mais de
 * 15 min, ex.: job de IA que morreu no meio). Sempre receita/despesa não pareada e não ignorada.
 * É o mesmo predicado da fila (`ReviewService.pending`) e da contagem do resumo do painel.
 */
export function pendingReviewWhere(
  workspaceId: string,
  filters: { entity?: AccountEntity; accountId?: string } = {},
  now = Date.now(),
): Prisma.TransactionWhereInput {
  return {
    workspaceId,
    OR: [
      { reviewStatus: "pending" },
      { reviewStatus: "ok", categorySource: "none", categoryId: null, createdAt: { lt: new Date(now - FORGOTTEN_AFTER_MS) } },
    ],
    ignored: false,
    transferPairId: null,
    type: { in: ["income", "expense"] },
    ...(filters.accountId ? { accountId: filters.accountId } : {}),
    ...(filters.entity ? { account: { entity: filters.entity } } : {}),
  };
}
