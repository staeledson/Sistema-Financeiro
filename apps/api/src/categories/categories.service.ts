import { Injectable, NotFoundException } from "@nestjs/common";
import type { CategoryInput } from "@app/shared";
import { prisma } from "../database";

@Injectable()
export class CategoriesService {
  async list(workspaceId: string, type?: string) {
    return prisma.category.findMany({
      where: { workspaceId, ...(type ? { type: type as "income" | "expense" } : {}) },
      select: { id: true, type: true, name: true, parentId: true, icon: true, color: true, isSystem: true },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
  }

  async create(workspaceId: string, dto: CategoryInput) {
    return prisma.category.create({
      data: { workspaceId, type: dto.type, name: dto.name, parentId: dto.parentId ?? null, icon: dto.icon ?? null, color: dto.color ?? null },
      select: { id: true, type: true, name: true, parentId: true, icon: true, color: true, isSystem: true },
    });
  }

  async update(workspaceId: string, id: string, dto: Partial<CategoryInput>) {
    const existing = await prisma.category.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException();
    return prisma.category.update({
      where: { id },
      data: { ...(dto.name ? { name: dto.name } : {}), ...(dto.icon !== undefined ? { icon: dto.icon } : {}), ...(dto.color !== undefined ? { color: dto.color } : {}) },
      select: { id: true, type: true, name: true, parentId: true, icon: true, color: true, isSystem: true },
    });
  }

  async remove(workspaceId: string, id: string) {
    const existing = await prisma.category.findFirst({ where: { id, workspaceId, isSystem: false } });
    if (!existing) throw new NotFoundException();
    await prisma.category.delete({ where: { id } });
    return { ok: true };
  }
}
