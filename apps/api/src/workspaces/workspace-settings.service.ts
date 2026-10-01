import { ForbiddenException, Injectable } from "@nestjs/common";
import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettingsInput } from "@app/shared";
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
  /** Lê sem escrever: sem linha, devolve os padrões. */
  async get(workspaceId: string) {
    const row = await prisma.workspaceSettings.findUnique({ where: { workspaceId }, select: SETTINGS_SELECT });
    return row ?? { ...DEFAULT_WORKSPACE_SETTINGS };
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
