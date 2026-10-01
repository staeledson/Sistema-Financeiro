import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { parseEntityQuery } from "../common/entity-query";
import { TransactionsService } from "./transactions.service";

const updateCategoryBody = z.object({
  categoryId: z.string().min(1).nullable(),
  applyToSimilar: z.boolean().default(false),
});

const TYPES = ["income", "expense", "transfer"] as const;
type TxType = (typeof TYPES)[number];

/** `?type=` (ausente, vazio, income, expense ou transfer). */
function parseTypeQuery(value?: string): TxType | undefined {
  if (value === undefined || value === "") return undefined;
  if ((TYPES as readonly string[]).includes(value)) return value as TxType;
  throw new BadRequestException("type deve ser income, expense ou transfer");
}

/** `?reportable=1`: regra de receita/despesa dos dashboards; só faz sentido junto de type income/expense. */
function parseReportableQuery(value: string | undefined, type: TxType | undefined): boolean {
  if (value === undefined || value === "" || value === "0") return false;
  if (value !== "1") throw new BadRequestException("reportable deve ser 1");
  if (type !== "income" && type !== "expense") throw new BadRequestException("reportable exige type income ou expense");
  return true;
}

@Controller("transactions")
@UseGuards(CurrentUserGuard)
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, user.id, body);
  }

  @Patch(":id/category")
  @HttpCode(200)
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const b = updateCategoryBody.parse(body);
    return this.service.updateCategory(user.workspaceId, id, b.categoryId, b.applyToSimilar);
  }

  @Post("categorize")
  @HttpCode(201)
  enqueueCategorizationJob(@CurrentUser() user: AuthenticatedUser) {
    return this.service.enqueueCategorizationJob(user.workspaceId, user.id);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("accountId") accountId?: string,
    @Query("categoryId") categoryId?: string,
    @Query("q") q?: string,
    @Query("entity") entity?: string,
    @Query("type") type?: string,
    @Query("reportable") reportable?: string,
  ) {
    const parsedType = parseTypeQuery(type);
    const onlyReportable = parseReportableQuery(reportable, parsedType);
    return this.service.list(user.workspaceId, {
      from, to, accountId, categoryId, q, entity: parseEntityQuery(entity), type: parsedType, reportable: onlyReportable,
    });
  }
}
