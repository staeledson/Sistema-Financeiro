import { Injectable } from "@nestjs/common";
import { prisma } from "../database";
import { REPORTABLE } from "../common/reportable";
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
      prisma.transaction.count({ where: { workspaceId, reviewStatus: "pending", ...REPORTABLE } }),
      this.cards.get(workspaceId, { asOf }),
      this.spending.get(workspaceId, { period, asOf }),
    ]);

    const upcoming = cards
      .filter((c) => c.configured && c.dueDate != null && c.dueDate >= asOf && (c.openInvoiceCents ?? 0) > 0)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    const next = upcoming[0];

    return {
      balances,
      pendingCount,
      nextInvoice: next ? { accountId: next.accountId, name: next.name, dueDate: next.dueDate!, openInvoiceCents: next.openInvoiceCents! } : null,
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
