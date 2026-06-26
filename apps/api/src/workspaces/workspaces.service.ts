import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberRole } from "../generated/prisma/enums";
import { prisma } from "../database";
import { seedDefaultCategories } from "../categories/seed-categories";

const ALLOWED_ROLE_MANAGE: MemberRole[] = ["owner", "admin"];

@Injectable()
export class WorkspacesService {
  async listForUser(userId: string) {
    return prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      select: { id: true, type: true, name: true, currency: true, createdById: true },
    });
  }

  async create(userId: string, body: { type: string; name: string; currency?: string }) {
    if (!["personal", "family", "business"].includes(body.type)) {
      throw new BadRequestException("tipo de workspace inválido");
    }
    const workspace = await prisma.workspace.create({
      data: {
        type: body.type as never,
        name: body.name,
        currency: body.currency ?? "BRL",
        createdById: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: { id: true, type: true, name: true, currency: true },
    });
    await seedDefaultCategories(workspace.id);
    return workspace;
  }

  async addMember(workspaceId: string, requesterId: string, body: { userId: string; role: MemberRole }) {
    const requesterMembership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: requesterId } },
    });

    if (!requesterMembership || !ALLOWED_ROLE_MANAGE.includes(requesterMembership.role)) {
      throw new ForbiddenException("Insufficient permissions");
    }

    return prisma.workspaceMember.create({
      data: { workspaceId, userId: body.userId, role: body.role },
    });
  }

  async listMembers(workspaceId: string) {
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        id: true, role: true, createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async updateMemberRole(workspaceId: string, requesterId: string, targetUserId: string, role: MemberRole) {
    await this.assertManagePermission(workspaceId, requesterId);

    if (role === "owner") {
      // Check caller is owner to promote to owner
      const callerMembership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: requesterId } },
        select: { role: true },
      });
      if (callerMembership?.role !== "owner") throw new ForbiddenException("apenas owner pode promover a owner");
    }

    return prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role },
      select: { id: true, role: true },
    });
  }

  async removeMember(workspaceId: string, requesterId: string, targetUserId: string) {
    await this.assertManagePermission(workspaceId, requesterId);
    await this.assertNotLastOwner(workspaceId, targetUserId);

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException("membro não encontrado");

    await prisma.workspaceMember.delete({ where: { id: membership.id } });
    return { removed: true };
  }

  private async assertManagePermission(workspaceId: string, userId: string) {
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!m || !ALLOWED_ROLE_MANAGE.includes(m.role)) throw new ForbiddenException("sem permissão");
  }

  private async assertNotLastOwner(workspaceId: string, targetUserId: string) {
    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { role: true },
    });
    if (target?.role !== "owner") return;

    const ownerCount = await prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } });
    if (ownerCount <= 1) throw new ConflictException("não é possível remover o único owner do workspace");
  }
}
