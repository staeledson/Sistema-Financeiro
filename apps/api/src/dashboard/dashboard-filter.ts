import { BadRequestException } from "@nestjs/common";
import { dashboardFilterSchema, isoDate, resolvePeriod, type AccountEntity } from "@app/shared";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database";

export type Scope = { entity?: AccountEntity; accountId?: string };

/** Lê o filtro global (entity, accountId, período, asOf) da query string; valores vazios são ignorados. */
export function parseDashboardFilter(query: Record<string, string | undefined>, today = isoDate(new Date())) {
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ""));
  const f = dashboardFilterSchema.parse(clean);
  const asOf = f.asOf ?? today;
  return {
    entity: f.entity === "all" ? undefined : (f.entity as AccountEntity),
    accountId: f.accountId,
    asOf,
    period: resolvePeriod(f, asOf),
  };
}

/** Escopo em SQL; a consulta precisa de `LEFT JOIN bank_accounts a ON a."id" = t."accountId"`. */
export function scopeSql(scope: Scope) {
  return Prisma.sql`${scope.accountId ? Prisma.sql`AND t."accountId" = ${scope.accountId}` : Prisma.empty}
    ${scope.entity ? Prisma.sql`AND a."entity"::text = ${scope.entity}` : Prisma.empty}`;
}

export async function assertScopeAccount(workspaceId: string, accountId?: string) {
  if (!accountId) return;
  const acc = await prisma.bankAccount.findFirst({ where: { id: accountId, workspaceId }, select: { id: true } });
  if (!acc) throw new BadRequestException("conta inexistente no workspace");
}
