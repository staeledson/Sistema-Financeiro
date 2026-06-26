import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { TransactionsService } from "./transactions.service";

@Controller("transactions")
@UseGuards(CurrentUserGuard)
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, user.id, body);
  }

  @Patch(":id/category")
  @HttpCode(200)
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { categoryId: string | null },
  ) {
    return this.service.updateCategory(user.workspaceId, id, body.categoryId);
  }

  @Post("categorize")
  @HttpCode(201)
  enqueueCategorizationJob(@CurrentUser() user: AuthenticatedUser) {
    return this.service.enqueueCategorizationJob(user.workspaceId, user.id);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("accountId") accountId?: string,
    @Query("categoryId") categoryId?: string,
    @Query("q") q?: string,
  ) {
    return this.service.list(user.workspaceId, { from, to, accountId, categoryId, q });
  }
}
