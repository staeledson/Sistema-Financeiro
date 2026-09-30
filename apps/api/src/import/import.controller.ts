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

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "data inválida");
const commitBody = z.object({
  rows: z.array(
    z.object({
      type: z.enum(["income", "expense"]),
      amountCents: z.number().int().min(0),
      date: isoDate,
      postedDate: isoDate.nullish(),
      accountId: z.string().min(1),
      description: z.string().nullish(),
      categoryId: z.string().nullish(),
      fingerprint: z.string().min(1),
    }),
  ),
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
  commit(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string, @Body() body: unknown) {
    const { rows } = commitBody.parse(body);
    return this.service.commit(
      user.workspaceId,
      user.id,
      batchId,
      rows.map((r) => ({ ...r, description: r.description ?? null })),
    );
  }

  @Post(":batchId/undo")
  @HttpCode(200)
  undo(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string) {
    return this.statements.undo(user.workspaceId, batchId);
  }

  @Get("batches")
  listBatches(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.listBatches(user.workspaceId);
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
