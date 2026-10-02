import { Injectable } from "@nestjs/common";
import { prisma } from "../database";
import { pendingReviewWhere } from "../common/pending-review";
import { previousPeriod, type AccountEntity } from "@app/shared";
import { parseDashboardFilter } from "./dashboard-filter";
import { CardsService } from "./cards.service";
import { CashflowService } from "./cashflow.service";
import { SpendingService } from "./spending.service";

const TOP_CATEGORIES = 6;

@Injectable()
export class SummaryService {
  constructor(
    private readonly cashflow: CashflowService,
    private readonly cards: CardsService,
    private readonly spending: SpendingService,
  ) {}

  /**
   * Resumo do Início: saldos, pendências e próxima fatura são sempre do workspace inteiro. Os gastos são do mês `month`
   * (YYYY-MM; sem ele, o mês de `asOf`) e, se vier `entity`, só dessa entidade; `byEntity` mostra a divisão PF/PJ do
   * mês inteiro em qualquer caso.
   */
  async get(workspaceId: string, asOf: string, month?: string, entity?: AccountEntity) {
    const { period } = parseDashboardFilter({ month: month ?? asOf.slice(0, 7), asOf });
    const [{ consolidated, cards: cardBalances, accounts: balanceRows }, meta, pendingCount, { cards }, spending, byEntity] = await Promise.all([
      this.cashflow.consolidated(workspaceId, asOf),
      prisma.bankAccount.findMany({
        where: { workspaceId, archived: false },
        select: { id: true, institution: true, closingDay: true, dueDay: true },
      }),
      prisma.transaction.count({ where: pendingReviewWhere(workspaceId) }),
      this.cards.get(workspaceId, { asOf }),
      this.spending.get(workspaceId, { period, asOf, entity }),
      this.spending.entityTotals(workspaceId, period),
    ]);

    // Próximo vencimento a pagar: faturas fechadas ainda em aberto/parciais (saldo devedor) e a fatura aberta do ciclo.
    const candidates: Array<{ accountId: string; name: string; dueDate: string; openInvoiceCents: number; estimated: boolean }> = [];
    for (const c of cards) {
      if (!c.configured) continue;
      const before = candidates.length;
      for (const p of c.invoicePayments) {
        const remaining = p.invoiceCents - p.paidCents;
        if ((p.status === "open" || p.status === "partial") && p.due >= asOf && remaining > 0) {
          candidates.push({ accountId: c.accountId, name: c.name, dueDate: p.due, openInvoiceCents: remaining, estimated: false });
        }
      }
      if (c.dueDate != null && c.dueDate >= asOf && (c.openInvoiceCents ?? 0) > 0) {
        candidates.push({ accountId: c.accountId, name: c.name, dueDate: c.dueDate, openInvoiceCents: c.openInvoiceCents!, estimated: false });
      }
      // Sem fatura calculada (ex.: só o saldo foi conciliado), mas com dívida: estima pelo saldo devedor do cartão.
      if (candidates.length === before && c.usedCents > 0 && c.dueDate != null && c.dueDate >= asOf) {
        candidates.push({ accountId: c.accountId, name: c.name, dueDate: c.dueDate, openInvoiceCents: c.usedCents, estimated: true });
      }
    }
    const next = candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

    // Detalhe dos saldos: cada conta não arquivada (caixa e cartões), com o saldo já calculado acima; ordem: entidade, nome.
    const metaById = new Map(meta.map((m) => [m.id, m]));
    const accounts = balanceRows
      .map((r) => {
        const m = metaById.get(r.accountId);
        return {
          accountId: r.accountId,
          name: r.name,
          type: r.type,
          entity: r.entity,
          institution: m?.institution ?? "other",
          balanceCents: r.balanceCents,
          closingDay: m?.closingDay ?? null,
          dueDay: m?.dueDay ?? null,
        };
      })
      .sort((a, b) => a.entity.localeCompare(b.entity) || a.name.localeCompare(b.name, "pt-BR"));

    return {
      // pf/pj/total = saldo em contas (caixa, sem cartões); `cards` = dívida dos cartões (negativo = a pagar), mesmo formato.
      balances: { ...consolidated, cards: cardBalances },
      accounts,
      pendingCount,
      nextInvoice: next ?? null,
      // Distingue "nenhum cartão configurado" de "configurado, mas nada a vencer" no estado vazio do Início.
      cardsConfigured: cards.some((c) => c.configured),
      spending: {
        month: period.from.slice(0, 7),
        previousMonth: previousPeriod(period).from.slice(0, 7),
        totalCents: spending.totalCents,
        byEntity,
        insight: spending.insight,
        byCategory: spending.byCategory.slice(0, TOP_CATEGORIES),
        byMonth: spending.byMonth,
        vsBudget: spending.vsBudget,
      },
    };
  }
}
