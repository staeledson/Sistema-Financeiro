import { Injectable, NotFoundException } from "@nestjs/common";
import type { AccountEntity, CategoryInput } from "@app/shared";
import { prisma } from "../database";

const CATEGORY_SELECT = {
  id: true, type: true, name: true, parentId: true, icon: true, color: true, isSystem: true, entity: true,
} as const;

@Injectable()
export class CategoriesService {
  async list(workspaceId: string, type?: "income" | "expense", entity?: AccountEntity) {
    return prisma.category.findMany({
      where: {
        workspaceId,
        ...(type ? { type } : {}),
        ...(entity ? { entity: { in: [entity, "both"] as Array<AccountEntity | "both"> } } : {}),
      },
      select: CATEGORY_SELECT,
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
  }

  async create(workspaceId: string, dto: CategoryInput) {
    return prisma.category.create({
      data: {
        workspaceId, type: dto.type, name: dto.name, parentId: dto.parentId ?? null,
        icon: dto.icon ?? null, color: dto.color ?? null, entity: dto.entity,
      },
      select: CATEGORY_SELECT,
    });
  }

  async update(workspaceId: string, id: string, dto: Partial<CategoryInput>) {
    const existing = await prisma.category.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException();
    return prisma.category.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.entity ? { entity: dto.entity } : {}),
      },
      select: CATEGORY_SELECT,
    });
  }

  async remove(workspaceId: string, id: string) {
    const existing = await prisma.category.findFirst({ where: { id, workspaceId, isSystem: false } });
    if (!existing) throw new NotFoundException();
    await prisma.category.delete({ where: { id } });
    return { ok: true };
  }
}
