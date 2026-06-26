import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { BalancesService } from "./balances.service";

@Controller("balances")
@UseGuards(CurrentUserGuard)
export class BalancesController {
  constructor(private readonly service: BalancesService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getForWorkspace(user.workspaceId);
  }
}
