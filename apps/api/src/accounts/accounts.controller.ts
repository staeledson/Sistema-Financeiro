import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { accountSchema } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
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
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listActive(user.workspaceId);
  }

  @Patch(":id/archive")
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.archive(user.workspaceId, id);
  }
}
