import { Injectable } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class WorkspacesService {
  async listForUser(userId: string) {
    return prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      select: { id: true, type: true, name: true, currency: true, createdById: true },
    });
  }
}
