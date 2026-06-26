import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SplitsService } from "./splits.service";

@Controller()
@UseGuards(CurrentUserGuard)
export class SplitsController {
  constructor(private readonly service: SplitsService) {}

  @Post("transactions/:id/splits")
  @HttpCode(200)
  setSplits(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") transactionId: string,
    @Body() body: { splits: { userId: string; shareCents: number }[] },
  ) {
    return this.service.setSplits(user.workspaceId, transactionId, body.splits);
  }

  @Get("reports/member-balances")
  memberBalances(@CurrentUser() user: AuthenticatedUser) {
    return this.service.memberBalances(user.workspaceId);
  }
}
