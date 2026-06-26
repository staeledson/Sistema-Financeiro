import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
@UseGuards(CurrentUserGuard)
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listForUser(user.id);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: { type: string; name: string; currency?: string }) {
    return this.service.create(user.id, body);
  }

  @Get(":id/members")
  listMembers(@Param("id") workspaceId: string) {
    return this.service.listMembers(workspaceId);
  }

  @Post(":id/members")
  @HttpCode(201)
  addMember(
    @Param("id") workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { userId: string; role: string },
  ) {
    return this.service.addMember(workspaceId, user.id, body as { userId: string; role: any });
  }

  @Patch(":id/members/:userId/role")
  @HttpCode(200)
  updateMemberRole(
    @Param("id") workspaceId: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { role: string },
  ) {
    return this.service.updateMemberRole(workspaceId, user.id, targetUserId, body.role as any);
  }

  @Delete(":id/members/:userId")
  @HttpCode(200)
  removeMember(
    @Param("id") workspaceId: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeMember(workspaceId, user.id, targetUserId);
  }
}
