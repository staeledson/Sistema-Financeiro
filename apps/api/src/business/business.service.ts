import { ForbiddenException, Injectable } from "@nestjs/common";
import { prisma } from "../database";

@Injectable()
export class BusinessService {
  async getProfile(workspaceId: string) {
    return prisma.businessProfile.findUnique({
      where: { workspaceId },
      select: { workspaceId: true, cnpj: true, legalName: true },
    });
  }

  async upsertProfile(workspaceId: string, role: string, body: { cnpj?: string | null; legalName?: string | null }) {
    if (!["owner", "admin"].includes(role)) throw new ForbiddenException("sem permissão");

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { type: true } });
    if (workspace?.type !== "business") {
      throw new ForbiddenException("perfil PJ disponível apenas para workspaces business");
    }

    return prisma.businessProfile.upsert({
      where: { workspaceId },
      create: { workspaceId, cnpj: body.cnpj ?? null, legalName: body.legalName ?? null },
      update: { cnpj: body.cnpj ?? null, legalName: body.legalName ?? null },
      select: { workspaceId: true, cnpj: true, legalName: true },
    });
  }
}
