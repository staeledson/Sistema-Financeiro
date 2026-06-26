import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(CurrentUserGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Query("month") month = new Date().toISOString().slice(0, 7),
  ) {
    return this.service.get(user.workspaceId, month);
  }
}
