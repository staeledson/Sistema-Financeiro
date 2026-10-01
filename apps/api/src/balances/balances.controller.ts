import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { BalancesService } from "./balances.service";
import { assertScopeAccount, parseDashboardFilter } from "../dashboard/dashboard-filter";

@Controller("balances")
@UseGuards(CurrentUserGuard)
export class BalancesController {
  constructor(private readonly service: BalancesService) {}

  /** Sem parâmetros: contrato antigo (todas as contas, sem limite de data). `entity`, `accountId` e `asOf` são opcionais. */
  @Get()
  async get(@CurrentUser() user: AuthenticatedUser, @Query() query: Record<string, string>) {
    const f = parseDashboardFilter({ entity: query.entity, accountId: query.accountId, asOf: query.asOf });
    await assertScopeAccount(user.workspaceId, f.accountId);
    return this.service.getForWorkspace(user.workspaceId, { entity: f.entity, accountId: f.accountId }, query.asOf ? f.asOf : undefined);
  }
}
