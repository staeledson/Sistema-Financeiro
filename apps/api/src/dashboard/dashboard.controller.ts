import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { DashboardService } from "./dashboard.service";
import { SpendingService } from "./spending.service";
import { CardsService } from "./cards.service";
import { CashflowService } from "./cashflow.service";
import { SummaryService } from "./summary.service";
import { parseDashboardFilter } from "./dashboard-filter";

@Controller("dashboard")
@UseGuards(CurrentUserGuard)
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly spending: SpendingService,
    private readonly cards: CardsService,
    private readonly cashflow: CashflowService,
    private readonly summary: SummaryService,
  ) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Query("month") month = new Date().toISOString().slice(0, 7),
  ) {
    return this.service.get(user.workspaceId, month);
  }

  @Get("spending")
  getSpending(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.spending.get(user.workspaceId, parseDashboardFilter(query));
  }

  @Get("cards")
  getCards(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    const { entity, accountId, asOf } = parseDashboardFilter(query);
    return this.cards.get(user.workspaceId, { entity, accountId, asOf });
  }

  @Get("cashflow")
  getCashflow(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    const { entity, accountId, asOf } = parseDashboardFilter(query);
    return this.cashflow.get(user.workspaceId, { entity, accountId, asOf });
  }

  /**
   * Resumo do Início. Aceita o filtro global mas só usa `asOf`: entity, accountId e período são ignorados de propósito
   * (a home é sempre o workspace inteiro, com os gastos do mês de `asOf`).
   */
  @Get("summary")
  getSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    return this.summary.get(user.workspaceId, parseDashboardFilter(query).asOf);
  }
}
