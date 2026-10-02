import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, AuthenticatedUser } from "../auth/current-user.guard";
import { centsSchema, isoDateSchema } from "../common/zod";
import { BillsService } from "./bills.service";

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  amountCents: centsSchema,
  dueDate: isoDateSchema,
  recurrence: z.enum(["once", "weekly", "monthly", "yearly"]).default("monthly"),
  categoryId: z.string().min(1).nullish(),
});
export type BillInput = z.infer<typeof createBody>;

@Controller("bills")
@UseGuards(CurrentUserGuard)
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.bills.list(req.user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @Req() req: { user: AuthenticatedUser }) {
    return this.bills.create(req.user.workspaceId, req.user.id, createBody.parse(body));
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.bills.remove(req.user.workspaceId, id);
  }
}
