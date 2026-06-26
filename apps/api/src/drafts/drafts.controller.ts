import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { DraftsService } from "./drafts.service";

@Controller("drafts")
@UseGuards(CurrentUserGuard)
export class DraftsController {
  constructor(private readonly service: DraftsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Post(":id/confirm")
  @HttpCode(201)
  confirm(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.service.confirm(user.workspaceId, user.id, id, body as Parameters<DraftsService["confirm"]>[3]);
  }

  @Delete(":id")
  discard(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.discard(user.workspaceId, id);
  }
}
