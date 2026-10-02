import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { InvitationsService } from "./invitations.service";

/** Convite nunca concede owner: a promoção é feita depois, pelo próprio owner. */
const createBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});
const acceptBody = z.object({ token: z.string().min(1).max(200) });

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
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, user.id, user.role, createBody.parse(body));
  }

  @Post("accept")
  @HttpCode(200)
  accept(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.accept(acceptBody.parse(body).token, user.email, user.id);
  }

  @Delete(":id")
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.revoke(user.workspaceId, id, user.role);
  }
}
