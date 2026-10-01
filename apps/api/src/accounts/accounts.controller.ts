import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { accountReconcileSchema, accountSchema, accountUpdateSchema } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { parseEntityQuery } from "../common/entity-query";
import { AccountsService } from "./accounts.service";

@Controller("accounts")
@UseGuards(CurrentUserGuard)
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, accountSchema.parse(body));
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("entity") entity?: string) {
    return this.service.listActive(user.workspaceId, parseEntityQuery(entity));
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.update(user.workspaceId, id, accountUpdateSchema.parse(body));
  }

  /** Conciliação: o usuário informa o saldo real de hoje e o saldo inicial da conta absorve a diferença. */
  @Post(":id/reconcile")
  @HttpCode(200)
  reconcile(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.reconcile(user.workspaceId, id, accountReconcileSchema.parse(body).balanceCents);
  }

  @Patch(":id/archive")
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.archive(user.workspaceId, id);
  }
}
