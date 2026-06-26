import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { IngestService } from "./ingest.service";

@Controller("ingest")
@UseGuards(CurrentUserGuard)
export class IngestController {
  constructor(private readonly service: IngestService) {}

  @Post("text")
  @HttpCode(201)
  text(@CurrentUser() user: AuthenticatedUser, @Body() body: { text: string }) {
    return this.service.enqueueText(user.workspaceId, user.id, body.text);
  }

  @Post("upload-url")
  @HttpCode(201)
  uploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { ext: string; contentType: string },
  ) {
    return this.service.getUploadUrl(user.workspaceId, body.ext, body.contentType);
  }

  @Post("image")
  @HttpCode(201)
  image(@CurrentUser() user: AuthenticatedUser, @Body() body: { storagePath: string }) {
    return this.service.enqueueFile(user.workspaceId, user.id, "parse_image", body.storagePath);
  }

  @Post("audio")
  @HttpCode(201)
  audio(@CurrentUser() user: AuthenticatedUser, @Body() body: { storagePath: string }) {
    return this.service.enqueueFile(user.workspaceId, user.id, "parse_audio", body.storagePath);
  }

  @Get("jobs/:id")
  job(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.getJob(user.workspaceId, id);
  }
}
