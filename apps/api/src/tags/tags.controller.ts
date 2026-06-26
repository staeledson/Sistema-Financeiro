import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { TagsService } from "./tags.service";

const tagSchema = z.object({ name: z.string().min(1) });

@Controller("tags")
@UseGuards(CurrentUserGuard)
export class TagsController {
  constructor(private readonly service: TagsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const { name } = tagSchema.parse(body);
    return this.service.upsert(user.workspaceId, name);
  }
}
