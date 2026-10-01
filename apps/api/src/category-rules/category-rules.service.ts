import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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

  async create(workspaceId: string, data: { matchType: "contains" | "equals" | "regex"; pattern: string; categoryId: string; priority?: number }) {
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
    const category = await prisma.category.findFirst({ where: { id: data.categoryId, workspaceId }, select: { id: true } });
    if (!category) throw new NotFoundException("categoria não encontrada");
    const priority = data.priority ?? 100;
    // Campos explícitos: nada do corpo é espalhado no banco, o workspace vem sempre do contexto autenticado e o hitCount não é do cliente.
    return prisma.categoryRule.upsert({
      where: { workspaceId_matchType_pattern: { workspaceId, matchType: data.matchType, pattern } },
      create: { workspaceId, matchType: data.matchType, pattern, categoryId: category.id, priority },
      update: { categoryId: category.id, priority },
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
  ): Promise<boolean> {
    const rule = ruleFromCorrection(tx, categoryId);
    if (!rule) return false;
    await this.create(workspaceId, rule);
    return true;
  }
}
