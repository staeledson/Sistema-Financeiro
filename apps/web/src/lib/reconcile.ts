import type { Transaction } from "./api";

/**
 * Lançamentos da conta com data depois de hoje, entre os já carregados no store: quantos são e quanto somam
 * (efeito líquido no saldo). Eles já entram no saldo "de hoje" que o sistema mostra, o que costuma explicar
 * diferenças contra o saldo do banco.
 */
export function futureActivity(
  transactions: Pick<Transaction, "type" | "amountCents" | "date" | "accountId" | "sourceAccountId" | "destAccountId">[],
  accountId: string,
  todayISO: string,
): { count: number; netCents: number } {
  let count = 0;
  let netCents = 0;
  for (const t of transactions) {
    if (t.date.slice(0, 10) <= todayISO) continue;
    let delta = 0;
    if (t.type === "income" && t.accountId === accountId) delta = t.amountCents;
    else if (t.type === "expense" && t.accountId === accountId) delta = -t.amountCents;
    else if (t.type === "transfer" && t.destAccountId === accountId) delta = t.amountCents;
    else if (t.type === "transfer" && t.sourceAccountId === accountId) delta = -t.amountCents;
    else continue;
    count++;
    netCents += delta;
  }
  return { count, netCents };
}
