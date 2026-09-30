import { prisma } from "../database";

type SeedCategory = { type: "income" | "expense"; name: string; entity: "both" | "pj" };

const PESSOAIS: SeedCategory[] = [
  { type: "income", name: "Salário", entity: "both" },
  { type: "income", name: "Freelance", entity: "both" },
  { type: "income", name: "Investimentos", entity: "both" },
  { type: "income", name: "Reembolso", entity: "both" },
  { type: "income", name: "Outras receitas", entity: "both" },
  { type: "expense", name: "Moradia", entity: "both" },
  { type: "expense", name: "Contas e utilidades", entity: "both" },
  { type: "expense", name: "Supermercado", entity: "both" },
  { type: "expense", name: "Restaurantes e delivery", entity: "both" },
  { type: "expense", name: "Transporte", entity: "both" },
  { type: "expense", name: "Combustível", entity: "both" },
  { type: "expense", name: "Saúde", entity: "both" },
  { type: "expense", name: "Farmácia", entity: "both" },
  { type: "expense", name: "Educação", entity: "both" },
  { type: "expense", name: "Lazer", entity: "both" },
  { type: "expense", name: "Compras", entity: "both" },
  { type: "expense", name: "Assinaturas", entity: "both" },
  { type: "expense", name: "Impostos e taxas", entity: "both" },
  { type: "expense", name: "Pets", entity: "both" },
  { type: "expense", name: "Outras despesas", entity: "both" },
];

const PJ: SeedCategory[] = [
  { type: "income", name: "Receita de serviços", entity: "pj" },
  { type: "expense", name: "Pró-labore", entity: "pj" },
  { type: "expense", name: "Impostos e tributos", entity: "pj" },
  { type: "expense", name: "Fornecedores", entity: "pj" },
  { type: "expense", name: "Serviços contratados", entity: "pj" },
  { type: "expense", name: "Tarifas bancárias", entity: "pj" },
  { type: "expense", name: "Folha e terceiros", entity: "pj" },
];

/** Linhas (sem workspaceId) das categorias de fábrica; usadas pelo onboarding e por `seedDefaultCategories`. */
export function defaultCategoryRows() {
  return [...PESSOAIS, ...PJ].map((c) => ({ ...c, isSystem: true as const }));
}

export async function seedDefaultCategories(workspaceId: string) {
  await prisma.category.createMany({
    data: defaultCategoryRows().map((c) => ({ ...c, workspaceId })),
    skipDuplicates: true,
  });
}
