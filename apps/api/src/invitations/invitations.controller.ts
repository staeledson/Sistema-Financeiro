import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { InvitationsService } from "./invitations.service";

@Controller("invitations")
@UseGuards(CurrentUserGuard)
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: { email: string; role?: string }) {
    return this.service.create(user.workspaceId, user.id, user.role, body);
  }

  @Post("accept")
  @HttpCode(200)
  accept(@CurrentUser() user: AuthenticatedUser, @Body() body: { token: string }) {
    return this.service.accept(body.token, user.email, user.id);
  }

  @Delete(":id")
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.revoke(user.workspaceId, id, user.role);
  }
}
