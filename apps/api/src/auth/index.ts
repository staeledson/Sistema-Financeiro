import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer } from "better-auth/plugins";
import { prisma } from "../database";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  plugins: [bearer()],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const ws = await prisma.workspace.create({
            data: {
              type: "personal",
              name: "Pessoal",
              currency: "BRL",
              createdById: user.id,
              members: { create: { userId: user.id, role: "owner" } },
              categories: {
                createMany: {
                  data: [
                    { type: "income", name: "Salário", isSystem: true },
                    { type: "income", name: "Freelance", isSystem: true },
                    { type: "income", name: "Investimentos", isSystem: true },
                    { type: "income", name: "Reembolso", isSystem: true },
                    { type: "income", name: "Outras receitas", isSystem: true },
                    { type: "expense", name: "Moradia", isSystem: true },
                    { type: "expense", name: "Contas e utilidades", isSystem: true },
                    { type: "expense", name: "Supermercado", isSystem: true },
                    { type: "expense", name: "Restaurantes e delivery", isSystem: true },
                    { type: "expense", name: "Transporte", isSystem: true },
                    { type: "expense", name: "Combustível", isSystem: true },
                    { type: "expense", name: "Saúde", isSystem: true },
                    { type: "expense", name: "Farmácia", isSystem: true },
                    { type: "expense", name: "Educação", isSystem: true },
                    { type: "expense", name: "Lazer", isSystem: true },
                    { type: "expense", name: "Compras", isSystem: true },
                    { type: "expense", name: "Assinaturas", isSystem: true },
                    { type: "expense", name: "Impostos e taxas", isSystem: true },
                    { type: "expense", name: "Pets", isSystem: true },
                    { type: "expense", name: "Outras despesas", isSystem: true },
                  ],
                },
              },
            },
          });
          return ws;
        },
      },
    },
  },
});
