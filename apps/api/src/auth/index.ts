import "../load-env";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { prisma } from "../database";
import { defaultCategoryRows } from "../categories/seed-categories";
import { isSignupAllowed, SIGNUP_DENIED_MESSAGE } from "./signup-policy";
import { buildTrustedOrigins, normalizeBaseUrl } from "./origins";

const baseURL = normalizeBaseUrl(process.env["BETTER_AUTH_URL"]);

export const auth = betterAuth({
  secret: process.env["BETTER_AUTH_SECRET"],
  baseURL,
  trustedOrigins: buildTrustedOrigins(baseURL, process.env["TRUSTED_ORIGINS"], process.env["NODE_ENV"]),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true },
  plugins: [bearer()],
  databaseHooks: {
    user: {
      create: {
        // Cadastro fechado em produção: lido a cada chamada para poder ser alterado nos testes.
        before: async (user) => {
          if (!isSignupAllowed(user.email, process.env["SIGNUP_ALLOWED_EMAILS"])) {
            throw new APIError("FORBIDDEN", { message: SIGNUP_DENIED_MESSAGE });
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
