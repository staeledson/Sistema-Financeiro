import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { BusinessService } from "./business.service";

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
  upsertProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { cnpj?: string | null; legalName?: string | null },
  ) {
    return this.service.upsertProfile(user.workspaceId, user.role, body);
  }
}
