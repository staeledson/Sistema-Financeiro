import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { z } from "zod";
import { CategoryRulesService } from "./category-rules.service";

/** Corpo de POST /category-rules: só estes campos; qualquer outro (workspaceId, hitCount…) é recusado. */
const createRuleBody = z
  .object({
    matchType: z.enum(["contains", "equals", "regex"]),
    pattern: z.string().trim().min(1).max(200),
    categoryId: z.string().min(1),
    priority: z.number().int().optional(),
  })
  .strict();

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
    @Body() body: unknown,
  ) {
    return this.service.create(user.workspaceId, createRuleBody.parse(body));
  }

  @Delete(":id")
  @HttpCode(204)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }
}
