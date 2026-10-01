import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { DashboardService } from "./dashboard.service";
import { SpendingService } from "./spending.service";
import { parseDashboardFilter } from "./dashboard-filter";

@Controller("dashboard")
@UseGuards(CurrentUserGuard)
export class DashboardController {
  constructor(
    private readonly service: DashboardService,
    private readonly spending: SpendingService,
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
}
