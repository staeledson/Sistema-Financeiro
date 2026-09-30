import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { cardFieldsPresent, type AccountEntity, type AccountInput, type AccountUpdateInput } from "@app/shared";
import { prisma } from "../database";

const ACCOUNT_SELECT = {
  id: true,
  type: true,
  name: true,
  openingBalanceCents: true,
  archived: true,
  entity: true,
  institution: true,
  externalId: true,
  closingDay: true,
  dueDay: true,
  creditLimitCents: true,
} as const;

@Injectable()
export class AccountsService {
  async create(workspaceId: string, dto: AccountInput) {
    return prisma.bankAccount.create({
      data: {
        workspaceId,
        type: dto.type,
        name: dto.name,
        openingBalanceCents: dto.openingBalanceCents ?? 0,
        entity: dto.entity,
        institution: dto.institution,
        externalId: dto.externalId ?? null,
        closingDay: dto.closingDay ?? null,
        dueDay: dto.dueDay ?? null,
        creditLimitCents: dto.creditLimitCents ?? null,
      },
      select: ACCOUNT_SELECT,
    });
  }

  async listActive(workspaceId: string, entity?: AccountEntity) {
    return prisma.bankAccount.findMany({
      where: { workspaceId, archived: false, ...(entity ? { entity } : {}) },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: "asc" },
    });
  }

  async update(workspaceId: string, id: string, dto: AccountUpdateInput) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId }, select: { type: true } });
    if (!existing) throw new NotFoundException();
    if (existing.type !== "credit_card" && cardFieldsPresent(dto)) {
      throw new BadRequestException("closingDay, dueDay e creditLimitCents só valem para cartão de crédito");
    }
    return prisma.bankAccount.update({ where: { id }, data: dto, select: ACCOUNT_SELECT });
  }

  async archive(workspaceId: string, id: string) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException();
    await prisma.bankAccount.update({ where: { id }, data: { archived: true } });
    return { ok: true };
  }
}
