import { Controller, Get, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CurrentUserGuard, AuthenticatedUser } from "../auth/current-user.guard";
import { ExportService } from "./export.service";

@Controller("export")
@UseGuards(CurrentUserGuard)
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get("transactions.csv")
  async csv(@Req() req: { user: AuthenticatedUser }, @Res() res: FastifyReply) {
    const csv = await this.exportService.transactionsCsv(req.user.workspaceId);
    res.header("Content-Type", "text/csv; charset=utf-8");
    res.header("Content-Disposition", "attachment; filename=transactions.csv");
    res.send(csv);
  }

  @Get("transactions.xlsx")
  async xlsx(@Req() req: { user: AuthenticatedUser }, @Res() res: FastifyReply) {
    const buf = await this.exportService.transactionsXlsx(req.user.workspaceId);
    res.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.header("Content-Disposition", "attachment; filename=transactions.xlsx");
    res.send(buf);
  }

  @Get("backup.json")
  async backup(@Req() req: { user: AuthenticatedUser }) {
    return this.exportService.backupJson(req.user.workspaceId);
  }
}
