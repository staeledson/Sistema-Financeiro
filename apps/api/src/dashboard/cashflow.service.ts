import { Injectable } from "@nestjs/common";
import { addMonths, forecastCashflow, lastMonths, type AccountEntity, type ForecastMonth } from "@app/shared";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database";
import { reportableSql } from "../common/reportable";
import { BalancesService, type AccountBalanceRow } from "../balances/balances.service";
import { CardsService } from "./cards.service";
import { SpendingService } from "./spending.service";
import { assertScopeAccount, scopeSql, type Scope } from "./dashboard-filter";

export type CashflowFilter = Scope & { asOf: string };
export type Consolidated = { pfCents: number; pjCents: number; totalCents: number };
export type CashflowMonth = { month: string; incomeCents: number; expenseCents: number; transfersNetCents: number; balanceCents: number };

const MONTHS = 12;
const HISTORY_MONTHS = 6;
const FORECAST_MONTHS = 3;

type FlowRow = { month: string; income: bigint; expense: bigint; pairedIncome: bigint; pairedExpense: bigint; installments: bigint };
type NetRow = { month: string; net: bigint };

function consolidate(rows: Pick<AccountBalanceRow, "entity" | "balanceCents">[]): Consolidated {
  const sum = (entity: AccountEntity) => rows.filter((r) => r.entity === entity).reduce((s, r) => s + r.balanceCents, 0);
  const pfCents = sum("pf");
  const pjCents = sum("pj");
  return { pfCents, pjCents, totalCents: pfCents + pjCents };
}

@Injectable()
export class CashflowService {
  constructor(
    private readonly balances: BalancesService,
    private readonly cards: CardsService,
    private readonly spending: SpendingService,
  ) {}

  /** PF, PJ e total do workspace inteiro (ignora entidade e conta do filtro). */
  async consolidated(workspaceId: string, asOf: string): Promise<Consolidated> {
    return consolidate(await this.balances.accountBalances(workspaceId, {}, asOf));
  }

  async get(workspaceId: string, filter: CashflowFilter) {
    await assertScopeAccount(workspaceId, filter.accountId);
    const { asOf } = filter;
    const scope: Scope = { entity: filter.entity, accountId: filter.accountId };
    const asOfYm = asOf.slice(0, 7);

    const [accounts, all] = await Promise.all([
      this.balances.accountBalances(workspaceId, scope, asOf),
      this.balances.accountBalances(workspaceId, {}, asOf),
    ]);
    const series = await this.monthly(workspaceId, scope, asOf);
    const forecast = await this.forecast(workspaceId, scope, asOf, asOfYm, series, accounts.reduce((s, a) => s + a.balanceCents, 0));
    const monthly: CashflowMonth[] = series.map(({ installmentsCents: _installments, ...m }) => m);
    return { balances: { accounts, consolidated: consolidate(all) }, monthly, forecast };
  }

  /**
   * 12 meses terminando no mês de `asOf`. Receita/despesa seguem a regra de relatório (sem pares e ignorados);
   * `transfersNetCents` = receita pareada − despesa pareada; o saldo do fim do mês reflete o banco (pares, ignorados e
   * transferências contam) e, no último mês, bate com a soma de `accountBalances` do escopo. Movimentos até `asOf`.
   */
  private async monthly(workspaceId: string, scope: Scope, asOf: string): Promise<Array<CashflowMonth & { installmentsCents: number }>> {
    const months = lastMonths(asOf.slice(0, 7), MONTHS);
    const from = months[0] + "-01";

    const [flows, nets, opening] = await Promise.all([
      prisma.$queryRaw<FlowRow[]>`
        SELECT to_char(t."date", 'YYYY-MM') AS "month",
          COALESCE(SUM(t."amountCents") FILTER (WHERE t."type" = 'income' AND t."transferPairId" IS NULL AND t."ignored" = false), 0) AS "income",
          COALESCE(SUM(t."amountCents") FILTER (WHERE t."type" = 'expense' AND t."transferPairId" IS NULL AND t."ignored" = false), 0) AS "expense",
          COALESCE(SUM(t."amountCents") FILTER (WHERE t."type" = 'income' AND t."transferPairId" IS NOT NULL AND t."ignored" = false), 0) AS "pairedIncome",
          COALESCE(SUM(t."amountCents") FILTER (WHERE t."type" = 'expense' AND t."transferPairId" IS NOT NULL AND t."ignored" = false), 0) AS "pairedExpense",
          COALESCE(SUM(t."amountCents") FILTER (WHERE t."type" = 'expense' AND t."transferPairId" IS NULL AND t."ignored" = false AND t."installmentTotal" IS NOT NULL), 0) AS "installments"
        FROM transactions t
        LEFT JOIN bank_accounts a ON a."id" = t."accountId" AND a."workspaceId" = t."workspaceId"
        WHERE t."workspaceId" = ${workspaceId} AND t."type" IN ('income', 'expense')
          AND t."date" >= ${from}::date AND t."date" <= ${asOf}::date
          ${scopeSql(scope)}
        GROUP BY to_char(t."date", 'YYYY-MM')`,
      // Movimento líquido por mês, igual ao de `accountBalances` (inclui pares, ignorados e transferências).
      prisma.$queryRaw<NetRow[]>`
        SELECT to_char(t."date", 'YYYY-MM') AS "month",
          COALESCE(SUM(
            CASE
              WHEN t."type" = 'income' AND t."accountId" = a."id" THEN t."amountCents"
              WHEN t."type" = 'expense' AND t."accountId" = a."id" THEN -t."amountCents"
              WHEN t."type" = 'transfer' AND t."destAccountId" = a."id" THEN t."amountCents"
              WHEN t."type" = 'transfer' AND t."sourceAccountId" = a."id" THEN -t."amountCents"
              ELSE 0
            END), 0) AS "net"
        FROM bank_accounts a
        JOIN transactions t
          ON t."workspaceId" = a."workspaceId"
          AND (t."accountId" = a."id" OR t."sourceAccountId" = a."id" OR t."destAccountId" = a."id")
          AND t."date" <= ${asOf}::date
        WHERE a."workspaceId" = ${workspaceId} AND a."archived" = false
          ${scope.accountId ? Prisma.sql`AND a."id" = ${scope.accountId}` : Prisma.empty}
          ${scope.entity ? Prisma.sql`AND a."entity"::text = ${scope.entity}` : Prisma.empty}
        GROUP BY to_char(t."date", 'YYYY-MM')`,
      prisma.bankAccount.aggregate({
        where: {
          workspaceId, archived: false,
          ...(scope.accountId ? { id: scope.accountId } : {}),
          ...(scope.entity ? { entity: scope.entity } : {}),
        },
        _sum: { openingBalanceCents: true },
      }),
    ]);

    const flowOf = new Map(flows.map((r) => [r.month, r]));
    const netOf = new Map(nets.map((r) => [r.month, Number(r.net)]));
    let balance = Number(opening._sum.openingBalanceCents ?? 0n);
    for (const [month, net] of netOf) if (month < months[0]) balance += net;

    return months.map((month) => {
      balance += netOf.get(month) ?? 0;
      const f = flowOf.get(month);
      return {
        month,
        incomeCents: Number(f?.income ?? 0n),
        expenseCents: Number(f?.expense ?? 0n),
        transfersNetCents: Number(f?.pairedIncome ?? 0n) - Number(f?.pairedExpense ?? 0n),
        balanceCents: balance,
        installmentsCents: Number(f?.installments ?? 0n),
      };
    });
  }

  private async forecast(
    workspaceId: string, scope: Scope, asOf: string, asOfYm: string,
    monthly: Array<CashflowMonth & { installmentsCents: number }>, startBalanceCents: number,
  ): Promise<ForecastMonth[]> {
    const historyMonths = lastMonths(addMonths(asOfYm, -1), HISTORY_MONTHS);
    const byMonth = new Map(monthly.map((m) => [m.month, m]));
    const history = historyMonths.map((month) => ({
      month,
      incomeCents: byMonth.get(month)?.incomeCents ?? 0,
      expenseCents: byMonth.get(month)?.expenseCents ?? 0,
    }));
    const historyInstallmentsAvgCents = Math.round(
      historyMonths.reduce((s, m) => s + (byMonth.get(m)?.installmentsCents ?? 0), 0) / HISTORY_MONTHS,
    );

    const [recurring, bills, installments] = await Promise.all([
      this.spending.recurring(workspaceId, asOf, scope),
      prisma.scheduledBill.findMany({ where: { workspaceId, active: true } }),
      this.cards.installmentsAheadMonthly(workspaceId, scope, asOf),
    ]);

    return forecastCashflow({
      firstMonth: addMonths(asOfYm, 1),
      months: FORECAST_MONTHS,
      history,
      historyInstallmentsAvgCents,
      recurring,
      bills: bills.map((b) => ({
        name: b.name,
        amountCents: Number(b.amountCents),
        dueDate: b.dueDate.toISOString().slice(0, 10),
        recurrence: b.recurrence,
        active: b.active,
      })),
      installments,
      startBalanceCents,
    });
  }
}
