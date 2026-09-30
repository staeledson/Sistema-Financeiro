import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { workspaceSettingsUpdateSchema } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspaceSettingsService } from "./workspace-settings.service";

@Controller("workspaces/current/settings")
@UseGuards(CurrentUserGuard)
export class WorkspaceSettingsController {
  constructor(private readonly service: WorkspaceSettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.service.get(user.workspaceId);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.update(user.workspaceId, user.role, workspaceSettingsUpdateSchema.parse(body));
  }
}
