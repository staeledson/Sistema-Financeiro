import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { GoalsService } from "./goals.service";

@Controller("goals")
@UseGuards(CurrentUserGuard)
export class GoalsController {
  constructor(private readonly service: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: { name: string; targetCents: number; deadline?: string | null }) {
    return this.service.create(user.workspaceId, body);
  }

  @Delete(":id")
  @HttpCode(200)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }

  @Post(":id/contribute")
  @HttpCode(201)
  contribute(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { amountCents: number; date?: string },
  ) {
    return this.service.contribute(user.workspaceId, id, user.id, body);
  }
}
