import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SplitsService } from "./splits.service";

const splitsBody = z.object({
  splits: z.array(z.object({ userId: z.string().min(1), shareCents: z.number().int().nonnegative().safe() })).min(1).max(50),
});

@Controller()
@UseGuards(CurrentUserGuard)
export class SplitsController {
  constructor(private readonly service: SplitsService) {}

  @Post("transactions/:id/splits")
  @HttpCode(200)
  setSplits(@CurrentUser() user: AuthenticatedUser, @Param("id") transactionId: string, @Body() body: unknown) {
    return this.service.setSplits(user.workspaceId, transactionId, splitsBody.parse(body).splits);
  }

  @Get("reports/member-balances")
  memberBalances(@CurrentUser() user: AuthenticatedUser) {
    return this.service.memberBalances(user.workspaceId);
  }
}
