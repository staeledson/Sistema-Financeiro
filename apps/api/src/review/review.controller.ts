import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { parseEntityQuery } from "../common/entity-query";
import { ReviewService } from "./review.service";

const ids = z.array(z.string().min(1)).min(1).max(1000);
const categorizeBody = z.object({
  transactionIds: ids,
  categoryId: z.string().min(1),
  createRule: z.boolean().default(true),
  applyToSimilar: z.boolean().default(false),
});
const idsBody = z.object({ transactionIds: ids });
const markBody = z.object({ transactionId: z.string().min(1), counterpartTransactionId: z.string().min(1) });
const unpairBody = z.object({ transferPairId: z.string().min(1) });

@Controller("review")
@UseGuards(CurrentUserGuard)
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get("pending")
  pending(@CurrentUser() user: AuthenticatedUser, @Query("entity") entity?: string, @Query("accountId") accountId?: string) {
    return this.service.pending(user.workspaceId, { entity: parseEntityQuery(entity), accountId: accountId || undefined });
  }

  @Post("categorize")
  @HttpCode(200)
  categorize(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.categorize(user.workspaceId, categorizeBody.parse(body));
  }

  @Post("accept-suggestion")
  @HttpCode(200)
  accept(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.acceptSuggestion(user.workspaceId, idsBody.parse(body).transactionIds);
  }

  @Post("mark-transfer")
  @HttpCode(200)
  mark(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const b = markBody.parse(body);
    return this.service.markTransfer(user.workspaceId, b.transactionId, b.counterpartTransactionId);
  }

  @Post("unpair")
  @HttpCode(200)
  unpair(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.unpair(user.workspaceId, unpairBody.parse(body).transferPairId);
  }

  @Post("ignore")
  @HttpCode(200)
  ignore(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.ignore(user.workspaceId, idsBody.parse(body).transactionIds);
  }

  @Post("recategorize")
  @HttpCode(201)
  recategorize(@CurrentUser() user: AuthenticatedUser) {
    return this.service.recategorize(user.workspaceId, user.id);
  }

  @Get("transfer-candidates")
  candidates(@CurrentUser() user: AuthenticatedUser, @Query("transactionId") transactionId?: string) {
    return this.service.transferCandidates(user.workspaceId, transactionId ?? "");
  }
}
