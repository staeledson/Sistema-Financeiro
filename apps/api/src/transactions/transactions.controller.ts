import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { parseEntityQuery } from "../common/entity-query";
import { TransactionsService } from "./transactions.service";

const updateCategoryBody = z.object({
  categoryId: z.string().min(1).nullable(),
  applyToSimilar: z.boolean().default(false),
});

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
    @Body() body: unknown,
  ) {
    const b = updateCategoryBody.parse(body);
    return this.service.updateCategory(user.workspaceId, id, b.categoryId, b.applyToSimilar);
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
    @Query("entity") entity?: string,
  ) {
    return this.service.list(user.workspaceId, { from, to, accountId, categoryId, q, entity: parseEntityQuery(entity) });
  }
}
