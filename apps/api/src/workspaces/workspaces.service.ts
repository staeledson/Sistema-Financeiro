import { ForbiddenException, Injectable } from "@nestjs/common";
import type { MemberRole } from "../generated/prisma/enums";
import { prisma } from "../database";

@Injectable()
export class WorkspacesService {
  async listForUser(userId: string) {
    return prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      select: { id: true, type: true, name: true, currency: true, createdById: true },
    });
  }

  async addMember(workspaceId: string, requesterId: string, body: { userId: string; role: MemberRole }) {
    const requesterMembership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: requesterId } },
    });

    if (!requesterMembership || !["owner", "admin"].includes(requesterMembership.role)) {
      throw new ForbiddenException("Insufficient permissions");
    }

    return prisma.workspaceMember.create({
      data: { workspaceId, userId: body.userId, role: body.role },
    });
  }
}
