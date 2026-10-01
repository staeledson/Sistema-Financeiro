import "../load-env";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { prisma } from "../database";
import { defaultCategoryRows } from "../categories/seed-categories";
import { isSignupAllowed, parseTrustedOrigins } from "./signup-policy";

const baseURL = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3100";

export const auth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"],
  baseURL,
  trustedOrigins: [
    baseURL,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    ...parseTrustedOrigins(process.env["TRUSTED_ORIGINS"]),
  ],
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  plugins: [bearer()],
  databaseHooks: {
    user: {
      create: {
        // Cadastro fechado em produção: lido a cada chamada para poder ser alterado nos testes.
        before: async (user) => {
          if (!isSignupAllowed(user.email, process.env["SIGNUP_ALLOWED_EMAILS"])) {
            throw new APIError("FORBIDDEN", { message: "Cadastro não permitido para este email." });
          }
        },
        after: async (user) => {
          await prisma.workspace.create({
            data: {
              type: "personal",
              name: "Pessoal",
              currency: "BRL",
              createdById: user.id,
              members: { create: { userId: user.id, role: "owner" } },
              categories: { createMany: { data: defaultCategoryRows() } },
            },
          });
        },
      },
    },
  },
});
