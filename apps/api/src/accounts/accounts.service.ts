import { Injectable, NotFoundException } from "@nestjs/common";
import type { AccountInput } from "@app/shared";
import { prisma } from "../database";

@Injectable()
export class AccountsService {
  async create(workspaceId: string, dto: AccountInput) {
    return prisma.bankAccount.create({
      data: {
        workspaceId,
        type: dto.type,
        name: dto.name,
        openingBalanceCents: dto.openingBalanceCents ?? 0,
      },
      select: { id: true, type: true, name: true, openingBalanceCents: true, archived: true },
    });
  }

  async listActive(workspaceId: string) {
    return prisma.bankAccount.findMany({
      where: { workspaceId, archived: false },
      select: { id: true, type: true, name: true, openingBalanceCents: true, archived: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async archive(workspaceId: string, id: string) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException();
    await prisma.bankAccount.update({ where: { id }, data: { archived: true } });
    return { ok: true };
  }
}
