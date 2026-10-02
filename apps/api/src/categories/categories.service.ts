import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { foldText, isCatchAllCategoryName, type AccountEntity, type CategoryInput } from "@app/shared";
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
    const existing = await prisma.category.findFirst({ where: { id, workspaceId }, select: { name: true, isSystem: true, entity: true } });
    if (!existing) throw new NotFoundException();

    if (dto.name && existing.isSystem && isCatchAllCategoryName(existing.name) && foldText(dto.name.trim()) !== foldText(existing.name)) {
      throw new BadRequestException("esta é a categoria pega-tudo do sistema e não pode ser renomeada");
    }
    if (dto.entity && dto.entity !== existing.entity && dto.entity !== "both") {
      const other = dto.entity === "pf" ? "pj" : "pf";
      const conflicting = await prisma.transaction.count({ where: { workspaceId, categoryId: id, account: { entity: other } } });
      if (conflicting > 0) {
        throw new ConflictException(`${conflicting} lançamento(s) de contas ${other.toUpperCase()} usam esta categoria; recategorize-os antes`);
      }
    }

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
    // O FK é SET NULL: sem este reset os lançamentos ficariam sem categoria mas ainda marcados como categorizados.
    await prisma.$transaction([
      prisma.transaction.updateMany({
        where: { workspaceId, categoryId: id },
        data: { categorySource: "none", categoryConfidence: null, reviewStatus: "pending" },
      }),
      prisma.category.delete({ where: { id } }),
    ]);
    return { ok: true };
  }
}
