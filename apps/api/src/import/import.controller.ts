import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ImportService } from "./import.service";

@Controller("import")
@UseGuards(CurrentUserGuard)
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Post("csv/preview")
  @HttpCode(200)
  csvPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { accountId: string; mapping: unknown; csv: string },
  ) {
    return this.service.csvPreview(user.workspaceId, user.id, body.accountId, body.mapping, body.csv);
  }

  @Post("ofx/preview")
  @HttpCode(200)
  ofxPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { accountId: string; ofx: string },
  ) {
    return this.service.ofxPreview(user.workspaceId, user.id, body.accountId, body.ofx);
  }

  @Post(":batchId/commit")
  @HttpCode(200)
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("batchId") batchId: string,
    @Body() body: { rows: Array<{ type: string; amountCents: number; date: string; accountId: string; description: string | null; fingerprint: string; categoryId?: string | null }> },
  ) {
    return this.service.commit(user.workspaceId, user.id, batchId, body.rows as Parameters<ImportService["commit"]>[3]);
  }

  @Post("pdf")
  @HttpCode(201)
  enqueuePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { storagePath: string },
  ) {
    return this.service.enqueuePdf(user.workspaceId, user.id, body.storagePath);
  }

  @Get("mappings")
  listMappings(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMappings(user.workspaceId);
  }

  @Post("mappings")
  @HttpCode(201)
  saveMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; format: "csv" | "ofx" | "pdf"; mapping: unknown },
  ) {
    return this.service.saveMapping(user.workspaceId, body.name, body.format, body.mapping);
  }
}
