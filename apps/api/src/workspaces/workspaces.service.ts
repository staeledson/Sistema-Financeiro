import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberRole, WorkspaceType } from "../../generated/prisma/enums";
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

  async create(userId: string, body: { type: WorkspaceType; name: string; currency: string }) {
    const workspace = await prisma.workspace.create({
      data: {
        type: body.type,
        name: body.name,
        currency: body.currency,
        createdById: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: { id: true, type: true, name: true, currency: true },
    });
    await seedDefaultCategories(workspace.id);
    return workspace;
  }

  /** 403 quando o usuário não é membro do workspace (qualquer papel serve). */
  async assertMember(workspaceId: string, userId: string) {
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!m) throw new ForbiddenException("não é membro deste workspace");
    return m.role;
  }

  async addMember(workspaceId: string, requesterId: string, body: { userId: string; role: MemberRole }) {
    const requesterRole = await this.assertManagePermission(workspaceId, requesterId);
    if (body.role === "owner" && requesterRole !== "owner") throw new ForbiddenException("apenas owner pode adicionar outro owner");

    const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!user) throw new NotFoundException("usuário não encontrado");

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: body.userId } },
      select: { id: true },
    });
    if (existing) throw new ConflictException("o usuário já é membro deste workspace");

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

  /**
   * Owner muda qualquer papel; admin muda só papéis abaixo de owner (nem promove nem rebaixa owner).
   * O único owner não pode ser rebaixado.
   */
  async updateMemberRole(workspaceId: string, requesterId: string, targetUserId: string, role: MemberRole) {
    const requesterRole = await this.assertManagePermission(workspaceId, requesterId);

    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException("membro não encontrado");

    if ((target.role === "owner" || role === "owner") && requesterRole !== "owner") {
      throw new ForbiddenException("apenas owner altera o papel de um owner ou promove a owner");
    }
    if (target.role === "owner" && role !== "owner") await this.assertNotLastOwner(workspaceId, targetUserId);

    return prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role },
      select: { id: true, role: true },
    });
  }

  async removeMember(workspaceId: string, requesterId: string, targetUserId: string) {
    const requesterRole = await this.assertManagePermission(workspaceId, requesterId);

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { id: true, role: true },
    });
    if (!membership) throw new NotFoundException("membro não encontrado");
    if (membership.role === "owner" && requesterRole !== "owner") throw new ForbiddenException("apenas owner remove um owner");
    await this.assertNotLastOwner(workspaceId, targetUserId);

    await prisma.workspaceMember.delete({ where: { id: membership.id } });
    return { removed: true };
  }

  private async assertManagePermission(workspaceId: string, userId: string): Promise<MemberRole> {
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!m || !ALLOWED_ROLE_MANAGE.includes(m.role)) throw new ForbiddenException("sem permissão");
    return m.role;
  }

  private async assertNotLastOwner(workspaceId: string, targetUserId: string) {
    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { role: true },
    });
    if (target?.role !== "owner") return;

    const ownerCount = await prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } });
    if (ownerCount <= 1) throw new ConflictException("não é possível remover ou rebaixar o único owner do workspace");
  }
}
