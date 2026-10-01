import { categoryFits, normalizeDescriptionKey, type AccountEntity, type CategoryEntity } from "@app/shared";
import { prisma } from "../database";

const textOf = (t: { counterparty: string | null; description: string | null }) =>
  [t.counterparty, t.description].filter(Boolean).join(" ");

/**
 * Ids de lançamentos ainda sem categoria (pendentes ou `categorySource = none`, não ignorados, sem par) que têm a
 * mesma descrição normalizada e o mesmo tipo de algum dos `seeds`, e aos quais a categoria serve.
 */
export async function findSimilarUncategorizedIds(
  workspaceId: string,
  seeds: Array<{ id: string; type: "income" | "expense" | "transfer"; counterparty: string | null; description: string | null }>,
  category: { type: "income" | "expense"; entity: CategoryEntity },
): Promise<string[]> {
  // Chave vazia (só dígitos/pontuação) significa "não agrupável": nunca entra no conjunto de chaves.
  const keys = new Set<string>();
  for (const s of seeds) {
    const key = normalizeDescriptionKey(textOf(s));
    if (key) keys.add(`${s.type}|${key}`);
  }
  if (keys.size === 0) return [];
  const seedIds = new Set(seeds.map((s) => s.id));

  const candidates = await prisma.transaction.findMany({
    where: {
      workspaceId,
      type: category.type,
      ignored: false,
      transferPairId: null,
      OR: [{ reviewStatus: "pending" }, { categorySource: "none" }],
      categoryId: null,
    },
    select: { id: true, type: true, counterparty: true, description: true, account: { select: { entity: true } } },
  });

  return candidates
    .filter((c) => !seedIds.has(c.id))
    .filter((c) => {
      const key = normalizeDescriptionKey(textOf(c));
      return key !== "" && keys.has(`${c.type}|${key}`);
    })
    .filter((c) => categoryFits(category, { type: c.type }, (c.account?.entity ?? null) as AccountEntity | null))
    .map((c) => c.id);
}
