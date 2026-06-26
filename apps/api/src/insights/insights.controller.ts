import { Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { InsightsService } from "./insights.service";

@Controller("insights")
@UseGuards(CurrentUserGuard)
export class InsightsController {
  constructor(private readonly service: InsightsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("read") read?: string) {
    return this.service.list(user.workspaceId, read);
  }

  @Patch(":id/read")
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.markRead(user.workspaceId, id);
  }

  @Post("compute")
  @HttpCode(201)
  enqueueCompute(@CurrentUser() user: AuthenticatedUser) {
    return this.service.enqueueCompute(user.workspaceId, user.id);
  }
}
