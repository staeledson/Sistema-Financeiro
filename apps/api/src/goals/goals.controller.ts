import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { centsSchema, isoDateSchema } from "../common/zod";
import { GoalsService } from "./goals.service";

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  targetCents: centsSchema,
  deadline: isoDateSchema.nullish(),
});
const contributeBody = z.object({ amountCents: centsSchema, date: isoDateSchema.optional() });

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
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, createBody.parse(body));
  }

  @Delete(":id")
  @HttpCode(200)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }

  @Post(":id/contribute")
  @HttpCode(201)
  contribute(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.contribute(user.workspaceId, id, user.id, contributeBody.parse(body));
  }
}
