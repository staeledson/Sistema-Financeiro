import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, AuthenticatedUser } from "../auth/current-user.guard";
import { BillsService } from "./bills.service";

@Controller("bills")
@UseGuards(CurrentUserGuard)
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.bills.list(req.user.workspaceId);
  }

  @Post()
  create(@Body() body: any, @Req() req: { user: AuthenticatedUser }) {
    return this.bills.create(req.user.workspaceId, req.user.id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.bills.remove(req.user.workspaceId, id);
  }
}
