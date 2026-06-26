import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { BudgetsService } from "./budgets.service";

@Controller("budgets")
@UseGuards(CurrentUserGuard)
export class BudgetsController {
  constructor(private readonly service: BudgetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.service.status(user.workspaceId);
  }

  @Post()
  @HttpCode(200)
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() body: { method: string; categoryId?: string | null; limitCents?: number | null }) {
    return this.service.upsert(user.workspaceId, body);
  }

  @Delete(":id")
  @HttpCode(200)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }
}
