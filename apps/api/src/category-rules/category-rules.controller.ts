import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { CategoryRulesService } from "./category-rules.service";

@Controller("category-rules")
@UseGuards(CurrentUserGuard)
export class CategoryRulesController {
  constructor(private readonly service: CategoryRulesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { matchType: "contains" | "equals" | "regex"; pattern: string; categoryId: string; priority?: number },
  ) {
    return this.service.create(user.workspaceId, body);
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }
}
