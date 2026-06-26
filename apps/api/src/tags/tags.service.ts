import { Injectable } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class TagsService {
  async list(workspaceId: string) {
    return prisma.tag.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  async upsert(workspaceId: string, name: string) {
    return prisma.tag.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name },
      update: {},
      select: { id: true, name: true },
    });
  }
}
