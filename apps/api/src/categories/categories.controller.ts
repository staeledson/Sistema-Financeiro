import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { categorySchema } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { parseCategoryTypeQuery } from "../common/category-type-query";
import { parseEntityQuery } from "../common/entity-query";
import { CategoriesService } from "./categories.service";

@Controller("categories")
@UseGuards(CurrentUserGuard)
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("type") type?: string,
    @Query("entity") entity?: string,
  ) {
    return this.service.list(user.workspaceId, parseCategoryTypeQuery(type), parseEntityQuery(entity));
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, categorySchema.parse(body));
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.update(user.workspaceId, id, categorySchema.partial().parse(body));
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    await this.service.remove(user.workspaceId, id);
  }
}
