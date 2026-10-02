import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { MEMBER_ROLES, WORKSPACE_TYPES } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspacesService } from "./workspaces.service";

const roleSchema = z.enum(MEMBER_ROLES);
const createWorkspaceBody = z.object({
  type: z.enum(WORKSPACE_TYPES),
  name: z.string().trim().min(1).max(80),
  currency: z.string().trim().length(3).toUpperCase().default("BRL"),
});
const addMemberBody = z.object({ userId: z.string().min(1), role: roleSchema });
const updateRoleBody = z.object({ role: roleSchema });

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
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.id, createWorkspaceBody.parse(body));
  }

  /** Só membros do workspace enxergam a lista (nome e e-mail dos demais). */
  @Get(":id/members")
  async listMembers(@Param("id") workspaceId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertMember(workspaceId, user.id);
    return this.service.listMembers(workspaceId);
  }

  @Post(":id/members")
  @HttpCode(201)
  addMember(@Param("id") workspaceId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.addMember(workspaceId, user.id, addMemberBody.parse(body));
  }

  @Patch(":id/members/:userId/role")
  @HttpCode(200)
  updateMemberRole(
    @Param("id") workspaceId: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.service.updateMemberRole(workspaceId, user.id, targetUserId, updateRoleBody.parse(body).role);
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
