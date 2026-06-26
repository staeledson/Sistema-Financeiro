import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "../database";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
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
              members: {
                create: { userId: user.id, role: "owner" },
              },
            },
          });
          return ws;
        },
      },
    },
  },
});
