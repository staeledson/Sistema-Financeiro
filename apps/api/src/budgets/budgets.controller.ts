import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { isoDateSchema } from "../common/zod";
import { BudgetsService } from "./budgets.service";

const upsertBody = z
  .object({
    method: z.enum(["fixed", "needs", "wants", "savings"]),
    categoryId: z.string().min(1).nullish(),
    limitCents: z.number().int().nonnegative().safe().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.method === "fixed") {
      if (!v.categoryId) ctx.addIssue({ code: "custom", message: "orçamento fixo exige categoria" });
      if (v.limitCents == null) ctx.addIssue({ code: "custom", message: "orçamento fixo exige limite" });
    } else if (v.categoryId || v.limitCents != null) {
      ctx.addIssue({ code: "custom", message: "orçamento por bucket não tem categoria nem limite" });
    }
  });
export type BudgetUpsertInput = z.infer<typeof upsertBody>;

@Controller("budgets")
@UseGuards(CurrentUserGuard)
export class BudgetsController {
  constructor(private readonly service: BudgetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  /** `asOf` (YYYY-MM-DD, hoje no fuso do navegador) define o mês apurado. */
  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser, @Query("asOf") asOf?: string) {
    return this.service.status(user.workspaceId, asOf ? isoDateSchema.parse(asOf) : undefined);
  }

  @Post()
  @HttpCode(200)
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.upsert(user.workspaceId, upsertBody.parse(body));
  }

  @Delete(":id")
  @HttpCode(200)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }
}
