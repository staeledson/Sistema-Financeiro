import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { IngestService } from "./ingest.service";

const textBody = z.object({ text: z.string().trim().min(1).max(2000) });
const uploadUrlBody = z.object({
  ext: z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,8}$/, "extensão inválida"),
  contentType: z.string().trim().regex(/^(image|audio|application)\/[\w.+-]{1,60}$/, "tipo de conteúdo inválido"),
});
const storagePathBody = z.object({ storagePath: z.string().min(1).max(300) });

@Controller("ingest")
@UseGuards(CurrentUserGuard)
export class IngestController {
  constructor(private readonly service: IngestService) {}

  @Post("text")
  @HttpCode(201)
  text(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.enqueueText(user.workspaceId, user.id, textBody.parse(body).text);
  }

  @Post("upload-url")
  @HttpCode(201)
  uploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const b = uploadUrlBody.parse(body);
    return this.service.getUploadUrl(user.workspaceId, b.ext, b.contentType);
  }

  @Post("image")
  @HttpCode(201)
  image(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.enqueueFile(user.workspaceId, user.id, "parse_image", storagePathBody.parse(body).storagePath);
  }

  @Post("audio")
  @HttpCode(201)
  audio(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.enqueueFile(user.workspaceId, user.id, "parse_audio", storagePathBody.parse(body).storagePath);
  }

  @Get("jobs/:id")
  job(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.getJob(user.workspaceId, id);
  }
}
