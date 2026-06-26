import { prisma } from "../database";
import type { OpenRouterGateway } from "./openrouter";
import { applyRules } from "@app/shared";
import { mapCategory } from "./category-map";

export interface CategorizeJobData {
  jobId: string;
  workspaceId: string;
}

export async function processCategorize(
  data: CategorizeJobData,
  deps: { ai: OpenRouterGateway },
) {
  const { jobId, workspaceId } = data;

  const [rules, categories, uncategorized] = await Promise.all([
    prisma.categoryRule.findMany({
      where: { workspaceId },
      orderBy: { priority: "desc" },
      select: { matchType: true, pattern: true, categoryId: true, priority: true },
    }),
    prisma.category.findMany({
      where: { workspaceId },
      select: { id: true, name: true, type: true },
    }),
    prisma.transaction.findMany({
      where: { workspaceId, categoryId: null },
      select: { id: true, counterparty: true, description: true, type: true },
    }),
  ]);

  let categorizedByRule = 0;
  let categorizedByAI = 0;

  for (const tx of uncategorized) {
    const text = [tx.counterparty, tx.description].filter(Boolean).join(" ");
    if (!text) continue;

    const ruleHit = applyRules(text, rules as Parameters<typeof applyRules>[1]);
    if (ruleHit) {
      await prisma.transaction.update({ where: { id: tx.id }, data: { categoryId: ruleHit } });
      categorizedByRule++;
      continue;
    }

    // LLM fallback — few-shot from recent categorized transactions
    try {
      const examples = await prisma.transaction.findMany({
        where: { workspaceId, categoryId: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { counterparty: true, description: true, category: { select: { name: true } } },
      });
      const fewShot = examples
        .map((e) => `${e.counterparty ?? e.description ?? ""} → ${e.category?.name ?? ""}`)
        .join("\n");
      const prompt = `Categorias disponíveis: ${categories.map((c) => c.name).join(", ")}.\n\nExemplos:\n${fewShot}\n\nCategoria de "${text}":`;
      const { draft } = await deps.ai.parseText(prompt);
      const categoryId = mapCategory(draft.suggestedCategory ?? null, tx.type, categories);
      if (categoryId) {
        await prisma.transaction.update({ where: { id: tx.id }, data: { categoryId } });
        categorizedByAI++;
      }
    } catch { /* LLM fallback failures are non-fatal */ }
  }

  await prisma.aiJob.update({
    where: { id: jobId },
    data: {
      status: "done",
      result: { total: uncategorized.length, byRule: categorizedByRule, byAI: categorizedByAI },
    },
  });
}
