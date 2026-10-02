import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { BusinessService } from "./business.service";

const profileBody = z.object({
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 14, "CNPJ precisa ter 14 dígitos")
    .nullish(),
  legalName: z.string().trim().min(1).max(200).nullish(),
});

@Controller("business-profile")
@UseGuards(CurrentUserGuard)
export class BusinessController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getProfile(user.workspaceId);
  }

  @Post()
  @HttpCode(200)
  upsertProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.upsertProfile(user.workspaceId, user.role, profileBody.parse(body));
  }
}
