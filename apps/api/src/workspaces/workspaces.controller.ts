import { Controller, Get, UseGuards } from "@nestjs/common";
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
}
