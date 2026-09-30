import { ForbiddenException, Injectable } from "@nestjs/common";
import type { WorkspaceSettingsInput } from "@app/shared";
import { prisma } from "../database";

const SETTINGS_SELECT = {
  aiConfidenceThreshold: true,
  aiBatchSize: true,
  transferMatchWindowDays: true,
  ownerNames: true,
} as const;

const CAN_EDIT = ["owner", "admin"];

@Injectable()
export class WorkspaceSettingsService {
  /** Lê as configurações; a linha é criada com os padrões do banco na primeira leitura. */
  async get(workspaceId: string) {
    return prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: { workspaceId },
      update: {},
      select: SETTINGS_SELECT,
    });
  }

  async update(workspaceId: string, role: string, dto: Partial<WorkspaceSettingsInput>) {
    if (!CAN_EDIT.includes(role)) throw new ForbiddenException("apenas owner ou admin alteram as configurações");
    return prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...dto },
      update: dto,
      select: SETTINGS_SELECT,
    });
  }
}
