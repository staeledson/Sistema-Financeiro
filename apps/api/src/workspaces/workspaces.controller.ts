import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  @UseGuards(CurrentUserGuard)
  async list(@CurrentUser() user: { id: string }) {
    return this.service.listForUser(user.id);
  }

  @Post(":id/members")
  @UseGuards(CurrentUserGuard)
  @HttpCode(201)
  async addMember(
    @Param("id") workspaceId: string,
    @CurrentUser() user: { id: string },
    @Body() body: { userId: string; role: string },
  ) {
    return this.service.addMember(workspaceId, user.id, body as { userId: string; role: any });
  }
}
