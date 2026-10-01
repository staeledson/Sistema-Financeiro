import { Injectable } from "@nestjs/common";
import { prisma } from "../database";
import { pendingReviewWhere } from "../common/pending-review";
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

  /** Resumo do Início: sempre o workspace inteiro (sem entidade/conta) e o mês de `asOf`. */
  async get(workspaceId: string, asOf: string) {
    const { period } = parseDashboardFilter({ month: asOf.slice(0, 7), asOf });
    const [balances, pendingCount, { cards }, spending] = await Promise.all([
      this.cashflow.consolidated(workspaceId, asOf),
      prisma.transaction.count({ where: pendingReviewWhere(workspaceId) }),
      this.cards.get(workspaceId, { asOf }),
      this.spending.get(workspaceId, { period, asOf }),
    ]);

    // Próximo vencimento a pagar: faturas fechadas ainda em aberto/parciais (saldo devedor) e a fatura aberta do ciclo.
    const candidates: Array<{ accountId: string; name: string; dueDate: string; openInvoiceCents: number }> = [];
    for (const c of cards) {
      if (!c.configured) continue;
      for (const p of c.invoicePayments) {
        const remaining = p.invoiceCents - p.paidCents;
        if ((p.status === "open" || p.status === "partial") && p.due >= asOf && remaining > 0) {
          candidates.push({ accountId: c.accountId, name: c.name, dueDate: p.due, openInvoiceCents: remaining });
        }
      }
      if (c.dueDate != null && c.dueDate >= asOf && (c.openInvoiceCents ?? 0) > 0) {
        candidates.push({ accountId: c.accountId, name: c.name, dueDate: c.dueDate, openInvoiceCents: c.openInvoiceCents! });
      }
    }
    const next = candidates.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

    return {
      balances,
      pendingCount,
      nextInvoice: next ?? null,
      spending: {
        totalCents: spending.totalCents,
        insight: spending.insight,
        byCategory: spending.byCategory.slice(0, TOP_CATEGORIES),
        byMonth: spending.byMonth,
        vsBudget: spending.vsBudget,
      },
    };
  }
}
