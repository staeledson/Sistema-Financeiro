import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ImportService } from "./import.service";
import { ImportStatementService } from "./import-statement.service";

const detectBody = z.object({ fileName: z.string().min(1), contentBase64: z.string().min(1) });
const previewBody = z.object({
  accountId: z.string().min(1),
  text: z.string().min(1),
  format: z.enum(["ofx", "pdf_statement"]),
});

@Controller("import")
@UseGuards(CurrentUserGuard)
export class ImportController {
  constructor(
    private readonly service: ImportService,
    private readonly statements: ImportStatementService,
  ) {}

  @Post("detect")
  @HttpCode(200)
  detect(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.statements.detect(user.workspaceId, detectBody.parse(body));
  }

  @Post("preview")
  @HttpCode(200)
  preview(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.statements.preview(user.workspaceId, user.id, previewBody.parse(body));
  }

  @Post("csv/preview")
  @HttpCode(200)
  csvPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { accountId: string; mapping: unknown; csv: string },
  ) {
    return this.service.csvPreview(user.workspaceId, user.id, body.accountId, body.mapping, body.csv);
  }

  @Post(":batchId/commit")
  @HttpCode(200)
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("batchId") batchId: string,
    @Body() body: { rows: Array<{ type: string; amountCents: number; date: string; postedDate?: string | null; accountId: string; description: string | null; fingerprint: string; categoryId?: string | null }> },
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
