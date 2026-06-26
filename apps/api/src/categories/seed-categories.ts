import { prisma } from "../database";

const DEFAULT_CATEGORIES = [
  { type: "income" as const, name: "Salário" },
  { type: "income" as const, name: "Freelance" },
  { type: "income" as const, name: "Investimentos" },
  { type: "income" as const, name: "Reembolso" },
  { type: "income" as const, name: "Outras receitas" },
  { type: "expense" as const, name: "Moradia" },
  { type: "expense" as const, name: "Contas e utilidades" },
  { type: "expense" as const, name: "Supermercado" },
  { type: "expense" as const, name: "Restaurantes e delivery" },
  { type: "expense" as const, name: "Transporte" },
  { type: "expense" as const, name: "Combustível" },
  { type: "expense" as const, name: "Saúde" },
  { type: "expense" as const, name: "Farmácia" },
  { type: "expense" as const, name: "Educação" },
  { type: "expense" as const, name: "Lazer" },
  { type: "expense" as const, name: "Compras" },
  { type: "expense" as const, name: "Assinaturas" },
  { type: "expense" as const, name: "Impostos e taxas" },
  { type: "expense" as const, name: "Pets" },
  { type: "expense" as const, name: "Outras despesas" },
];

export async function seedDefaultCategories(workspaceId: string) {
  await prisma.category.createMany({
    data: DEFAULT_CATEGORIES.map((c) => ({ ...c, workspaceId, isSystem: true })),
    skipDuplicates: true,
  });
}
