import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { AccountEntity } from "@app/shared";
import { prisma } from "../database";

export type BalanceScope = { entity?: AccountEntity; accountId?: string };
export type AccountBalanceRow = { accountId: string; name: string; type: string; entity: AccountEntity; balanceCents: number };

/** Cliente que executa o SQL: o `prisma` global ou o `tx` de uma transação interativa. */
export type RawClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/** Cartão de crédito: o saldo é dívida futura (passivo), não caixa — fica fora do "saldo em contas". */
export const isCardType = (type: string): boolean => type === "credit_card";

@Injectable()
export class BalancesService {
  /**
   * Saldo por conta, em SQL. Reflete o banco: NÃO aplica `reportableSql` (pares e ignorados contam).
   * `asOf` (YYYY-MM-DD) limita aos movimentos com data até esse dia; omitido = sem limite.
   * `db` permite rodar dentro de uma transação interativa (padrão: o `prisma` global).
   */
  async accountBalances(workspaceId: string, scope: BalanceScope = {}, asOf?: string, db: RawClient = prisma): Promise<AccountBalanceRow[]> {
    const rows = await db.$queryRaw<Array<{ id: string; name: string; type: string; entity: AccountEntity; balance: bigint }>>`
      SELECT a."id", a."name", a."type"::text AS "type", a."entity"::text AS "entity",
        a."openingBalanceCents" + COALESCE(SUM(
          CASE
            WHEN t."type" = 'income' AND t."accountId" = a."id" THEN t."amountCents"
            WHEN t."type" = 'expense' AND t."accountId" = a."id" THEN -t."amountCents"
            WHEN t."type" = 'transfer' AND t."destAccountId" = a."id" THEN t."amountCents"
            WHEN t."type" = 'transfer' AND t."sourceAccountId" = a."id" THEN -t."amountCents"
            ELSE 0
          END), 0) AS "balance"
      FROM bank_accounts a
      LEFT JOIN transactions t
        ON t."workspaceId" = a."workspaceId"
        AND (t."accountId" = a."id" OR t."sourceAccountId" = a."id" OR t."destAccountId" = a."id")
        ${asOf ? Prisma.sql`AND t."date" <= ${asOf}::date` : Prisma.empty}
      WHERE a."workspaceId" = ${workspaceId} AND a."archived" = false
        ${scope.accountId ? Prisma.sql`AND a."id" = ${scope.accountId}` : Prisma.empty}
        ${scope.entity ? Prisma.sql`AND a."entity"::text = ${scope.entity}` : Prisma.empty}
      GROUP BY a."id", a."name", a."type", a."entity", a."openingBalanceCents", a."createdAt"
      ORDER BY a."createdAt" ASC, a."id" ASC`;
    return rows.map((r) => ({ accountId: r.id, name: r.name, type: r.type, entity: r.entity, balanceCents: Number(r.balance) }));
  }

  async getForWorkspace(workspaceId: string, scope: BalanceScope = {}, asOf?: string) {
    const rows = await this.accountBalances(workspaceId, scope, asOf);
    const accounts = rows.map(({ accountId, name, type, balanceCents }) => ({ accountId, name, type, balanceCents }));
    const sum = (list: typeof accounts) => list.reduce((s, b) => s + b.balanceCents, 0);
    return {
      accounts,
      // Saldo em contas (caixa): soma das contas que NÃO são cartão de crédito.
      consolidatedCents: sum(accounts.filter((a) => !isCardType(a.type))),
      // Dívida dos cartões: soma dos saldos dos cartões (negativo = a pagar), mostrada à parte.
      cardsCents: sum(accounts.filter((a) => isCardType(a.type))),
    };
  }
}
