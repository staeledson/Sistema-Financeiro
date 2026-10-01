import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "../database";
import { ruleFromCorrection } from "@app/shared";

const MAX_PATTERN_LENGTH = 200;

@Injectable()
export class CategoryRulesService {
  list(workspaceId: string) {
    return prisma.categoryRule.findMany({
      where: { workspaceId },
      orderBy: { priority: "desc" },
      select: { id: true, matchType: true, pattern: true, categoryId: true, priority: true, hitCount: true, createdAt: true },
    });
  }

  create(workspaceId: string, data: { matchType: "contains" | "equals" | "regex"; pattern: string; categoryId: string; priority?: number }) {
    if (!["contains", "equals", "regex"].includes(data.matchType)) {
      throw new BadRequestException("matchType deve ser contains, equals ou regex");
    }
    if (typeof data.pattern !== "string" || data.pattern.trim() === "") {
      throw new BadRequestException("o padrão da regra não pode ser vazio");
    }
    const pattern = data.pattern.trim();
    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new BadRequestException(`o padrão da regra deve ter no máximo ${MAX_PATTERN_LENGTH} caracteres`);
    }
    if (data.matchType === "regex") {
      try {
        new RegExp(pattern, "i");
      } catch {
        throw new BadRequestException("expressão regular inválida");
      }
    }
    return prisma.categoryRule.upsert({
      where: { workspaceId_matchType_pattern: { workspaceId, matchType: data.matchType, pattern } },
      create: { workspaceId, ...data, pattern, priority: data.priority ?? 100 },
      update: { categoryId: data.categoryId, priority: data.priority ?? 100 },
      select: { id: true },
    });
  }

  delete(workspaceId: string, id: string) {
    return prisma.categoryRule.deleteMany({ where: { id, workspaceId } });
  }

  async learnFromCorrection(
    tx: { counterparty?: string | null; description?: string | null },
    categoryId: string,
    workspaceId: string,
  ) {
    const rule = ruleFromCorrection(tx, categoryId);
    if (!rule.pattern) return;
    await this.create(workspaceId, rule);
  }
}
