import { Injectable } from "@nestjs/common";
import {
  addMonths, cycleClosingIn, cycleOf, daysBetweenISO, normalizeDescriptionKey, parseInstallment, recentCycles,
  type AccountEntity, type InvoiceCycle,
} from "@app/shared";
import { prisma } from "../database";
import { BalancesService } from "../balances/balances.service";
import { assertScopeAccount, type Scope } from "./dashboard-filter";

export type CardsFilter = Scope & { asOf: string };

export type InvoiceStatus = "paid" | "partial" | "open" | "overdue";
export type Card = {
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
  cycleDaily: Array<{ day: number; currentCents: number | null; avgPreviousCents: number }>;
  installmentsAhead: Array<{ month: string; amountCents: number; count: number }>;
  invoicePayments: Array<{ closing: string; due: string; invoiceCents: number; paidCents: number; status: InvoiceStatus }>;
};

type Row = {
  date: string;
  type: string;
  amountCents: bigint;
  paired: boolean;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  description: string | null;
  counterparty: string | null;
};
type Movement = {
  date: string; type: string; cents: number; paired: boolean;
  installmentCurrent: number | null; installmentTotal: number | null; description: string; counterparty: string;
};

type CardAccount = {
  id: string;
  name: string;
  entity: AccountEntity;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: bigint | null;
};

const CLOSED_CYCLES = 6;
const AVG_CYCLES = 3;
const AHEAD_MONTHS = 12;

const round1 = (n: number) => Math.round(n * 10) / 10;
const min = (a: string, b: string) => (a < b ? a : b);

/**
 * Efeito do lançamento na fatura: despesa soma, estorno (receita não pareada) subtrai; pagamento (pareada) não entra.
 * Pagamento registrado como `transfer` para o cartão não conta como pago (só receita pareada); lançamentos ignorados ficam fora.
 */
function invoiceEffect(m: Movement): number {
  if (m.type === "expense") return m.cents;
  if (m.type === "income" && !m.paired) return -m.cents;
  return 0;
}

@Injectable()
export class CardsService {
  constructor(private readonly balances: BalancesService) {}

  async get(workspaceId: string, filter: CardsFilter): Promise<{ cards: Card[] }> {
    await assertScopeAccount(workspaceId, filter.accountId);
    const accounts = await this.cardAccounts(workspaceId, filter);
    const balances = await this.balances.accountBalances(workspaceId, { entity: filter.entity, accountId: filter.accountId }, filter.asOf);
    const balanceOf = new Map(balances.map((b) => [b.accountId, b.balanceCents]));
    const cards = await Promise.all(accounts.map((a) => this.build(workspaceId, a, balanceOf.get(a.id) ?? 0, filter.asOf)));
    return { cards };
  }

  /** Soma das parcelas dos cartões do escopo por mês de vencimento: 12 meses a partir do mês seguinte a `asOf` (usado pela previsão). */
  async installmentsAheadMonthly(workspaceId: string, scope: Scope, asOf: string): Promise<Array<{ month: string; amountCents: number }>> {
    await assertScopeAccount(workspaceId, scope.accountId);
    const accounts = (await this.cardAccounts(workspaceId, scope)).filter((a) => a.closingDay != null && a.dueDay != null);
    const perCard = await Promise.all(accounts.map((a) => this.installmentsFor(workspaceId, a, asOf)));
    return Array.from({ length: AHEAD_MONTHS }, (_, i) => {
      const month = addMonths(asOf.slice(0, 7), i + 1);
      return { month, amountCents: perCard.reduce((s, list) => s + list[i].amountCents, 0) };
    });
  }

  private cardAccounts(workspaceId: string, scope: Scope): Promise<CardAccount[]> {
    return prisma.bankAccount.findMany({
      where: {
        workspaceId, type: "credit_card", archived: false,
        ...(scope.entity ? { entity: scope.entity } : {}),
        ...(scope.accountId ? { id: scope.accountId } : {}),
      },
      select: { id: true, name: true, entity: true, closingDay: true, dueDay: true, creditLimitCents: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  private async movements(workspaceId: string, accountId: string, from: string, to: string): Promise<Movement[]> {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT to_char(t."date", 'YYYY-MM-DD') AS "date", t."type"::text AS "type", t."amountCents",
        (t."transferPairId" IS NOT NULL) AS "paired", t."installmentCurrent", t."installmentTotal", t."description", t."counterparty"
      FROM transactions t
      WHERE t."workspaceId" = ${workspaceId} AND t."accountId" = ${accountId}
        AND t."ignored" = false
        AND t."type" IN ('expense', 'income')
        AND t."date" >= ${from}::date AND t."date" <= ${to}::date
      ORDER BY t."date" ASC
      LIMIT 50000`;
    return rows.map((r) => ({
      date: r.date, type: r.type, cents: Number(r.amountCents), paired: r.paired,
      installmentCurrent: r.installmentCurrent, installmentTotal: r.installmentTotal, description: r.description ?? "", counterparty: r.counterparty ?? "",
    }));
  }

  private async build(workspaceId: string, a: CardAccount, balanceCents: number, asOf: string): Promise<Card> {
    const limit = a.creditLimitCents != null ? Number(a.creditLimitCents) : null;
    const usedCents = Math.max(0, -balanceCents);
    const base = {
      accountId: a.id, name: a.name, entity: a.entity, closingDay: a.closingDay, dueDay: a.dueDay,
      creditLimitCents: limit, usedCents,
      limitUsedPct: limit ? round1((usedCents / limit) * 100) : null,
    };
    if (a.closingDay == null || a.dueDay == null) {
      return {
        ...base, configured: false, openInvoiceCents: null, closingDate: null, dueDate: null,
        cycleDaily: [], installmentsAhead: [], invoicePayments: [],
      };
    }

    const { open, closed } = recentCycles(asOf, a.closingDay, a.dueDay, CLOSED_CYCLES);
    const rows = await this.movements(workspaceId, a.id, closed[0].start, asOf);
    return {
      ...base,
      configured: true,
      openInvoiceCents: this.invoice(rows, open),
      closingDate: open.closing,
      dueDate: open.due,
      cycleDaily: this.cycleDaily(rows, open, closed, asOf),
      installmentsAhead: this.installmentsAhead(rows, asOf, a.closingDay, a.dueDay),
      invoicePayments: this.invoicePayments(rows, open, closed, asOf),
    };
  }

  private invoice(rows: Movement[], cycle: InvoiceCycle) {
    return rows.filter((m) => m.date >= cycle.start && m.date <= cycle.closing).reduce((s, m) => s + invoiceEffect(m), 0);
  }

  /** Faturas fechadas com movimento: valor, pago entre o fechamento e o fechamento seguinte (limitado a hoje) e situação. */
  private invoicePayments(rows: Movement[], open: InvoiceCycle, closed: InvoiceCycle[], asOf: string) {
    const out: Card["invoicePayments"] = [];
    closed.forEach((c, i) => {
      const nextClosing = i + 1 < closed.length ? closed[i + 1].closing : open.closing;
      const paidEnd = min(nextClosing, asOf);
      const invoiceCents = this.invoice(rows, c);
      const paidCents = rows
        .filter((m) => m.type === "income" && m.paired && m.date > c.closing && m.date <= paidEnd)
        .reduce((s, m) => s + m.cents, 0);
      if (invoiceCents === 0 && paidCents === 0) return;
      const status: InvoiceStatus =
        paidCents >= invoiceCents ? "paid" : paidCents > 0 ? "partial" : c.due < asOf ? "overdue" : "open";
      out.push({ closing: c.closing, due: c.due, invoiceCents, paidCents, status });
    });
    return out;
  }

  /** Acumulado líquido por dia do ciclo (índice 1..n); `last` repete o último valor além do fim do ciclo. */
  private cumulative(rows: Movement[], cycle: InvoiceCycle, n: number, until?: string) {
    const length = daysBetweenISO(cycle.start, cycle.closing) + 1;
    const perDay = new Array<number>(length + 1).fill(0);
    for (const m of rows) {
      if (m.date < cycle.start || m.date > cycle.closing || (until && m.date > until)) continue;
      perDay[daysBetweenISO(cycle.start, m.date) + 1] += invoiceEffect(m);
    }
    const out: number[] = [];
    let acc = 0;
    for (let d = 1; d <= n; d++) {
      if (d <= length) acc += perDay[d];
      out.push(acc);
    }
    return out;
  }

  private cycleDaily(rows: Movement[], open: InvoiceCycle, closed: InvoiceCycle[], asOf: string): Card["cycleDaily"] {
    const previous = closed.slice(-AVG_CYCLES);
    const duration = (c: InvoiceCycle) => daysBetweenISO(c.start, c.closing) + 1;
    const n = Math.max(duration(open), ...previous.map(duration));
    const current = this.cumulative(rows, open, n, asOf);
    const prevSeries = previous.map((c) => this.cumulative(rows, c, n));
    const lastOpenDay = Math.min(duration(open), daysBetweenISO(open.start, asOf) + 1);
    return Array.from({ length: n }, (_, i) => ({
      day: i + 1,
      currentCents: i + 1 <= lastOpenDay ? current[i] : null,
      avgPreviousCents: Math.round(prevSeries.reduce((s, series) => s + series[i], 0) / prevSeries.length),
    }));
  }

  private async installmentsFor(workspaceId: string, a: CardAccount, asOf: string) {
    const { closed } = recentCycles(asOf, a.closingDay!, a.dueDay!, CLOSED_CYCLES);
    const rows = await this.movements(workspaceId, a.id, closed[0].start, asOf);
    return this.installmentsAhead(rows, asOf, a.closingDay!, a.dueDay!);
  }

  /** Identidade da compra parcelada: descrição normalizada (ou contraparte, se a parcela veio dela), total e mês de origem. */
  private installmentKey(m: Movement, closingDay: number, dueDay: number) {
    const dKey = normalizeDescriptionKey(m.description);
    const cKey = normalizeDescriptionKey(m.counterparty);
    const name =
      dKey && parseInstallment(m.description) ? dKey
      : cKey && parseInstallment(m.counterparty) ? cKey
      : dKey || cKey || (m.description || m.counterparty).trim().toLowerCase();
    const origin = addMonths(cycleOf(m.date, closingDay, dueDay).ym, -m.installmentCurrent!);
    return `${name}|${m.installmentTotal}|${origin}`;
  }

  /**
   * Parcelas a pagar nos próximos 12 meses (a partir do mês seguinte a `asOf`), por mês de VENCIMENTO da fatura
   * (saída de caixa). Entram as já lançadas (na fatura em que caíram) e as restantes de cada compra, que a linha de
   * maior parcela projeta ciclo a ciclo. Sempre 12 entradas, zeros incluídos.
   */
  private installmentsAhead(rows: Movement[], asOf: string, closingDay: number, dueDay: number): Card["installmentsAhead"] {
    const months = Array.from({ length: AHEAD_MONTHS }, (_, i) => addMonths(asOf.slice(0, 7), i + 1));
    const byMonth = new Map(months.map((month) => [month, { month, amountCents: 0, count: 0 }]));
    const add = (month: string, cents: number) => {
      const slot = byMonth.get(month);
      if (slot) { slot.amountCents += cents; slot.count += 1; }
    };

    const latest = new Map<string, Movement>();
    for (const m of rows) {
      if (m.type !== "expense" || m.installmentCurrent == null || m.installmentTotal == null) continue;
      add(cycleOf(m.date, closingDay, dueDay).due.slice(0, 7), m.cents); // já lançada: paga no vencimento da fatura dela
      const key = this.installmentKey(m, closingDay, dueDay);
      const prev = latest.get(key);
      if (!prev || m.installmentCurrent > prev.installmentCurrent! || (m.installmentCurrent === prev.installmentCurrent && m.date > prev.date)) {
        latest.set(key, m);
      }
    }
    for (const m of latest.values()) {
      const rowYm = cycleOf(m.date, closingDay, dueDay).ym;
      for (let k = 1; k <= m.installmentTotal! - m.installmentCurrent!; k++) {
        add(cycleClosingIn(addMonths(rowYm, k), closingDay, dueDay).due.slice(0, 7), m.cents);
      }
    }
    return months.map((month) => byMonth.get(month)!);
  }
}
