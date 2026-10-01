import { parseTrustedOrigins } from "./signup-policy";

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:5174",
];

/** BETTER_AUTH_URL sem espaços nem barras no final (padrão: API local). */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  return value || "http://localhost:3100";
}

/** Origens confiáveis do Better Auth: a base, TRUSTED_ORIGINS e, fora de produção, o Vite local. */
export function buildTrustedOrigins(
  baseURL: string,
  trustedEnv: string | undefined,
  nodeEnv: string | undefined,
): string[] {
  const origins = [baseURL, ...(nodeEnv === "production" ? [] : DEV_ORIGINS), ...parseTrustedOrigins(trustedEnv)];
  return [...new Set(origins)];
}

/** Aviso para o log de boot quando a URL base parece não configurada em produção. */
export function baseUrlWarning(raw: string | undefined, nodeEnv: string | undefined): string | null {
  if (nodeEnv !== "production") return null;
  const value = (raw ?? "").trim();
  if (!value) return "BETTER_AUTH_URL não definida em produção: use a origem pública do front (https://...).";
  if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(value)) {
    return "BETTER_AUTH_URL aponta para localhost em produção: use a origem pública do front (https://...).";
  }
  return null;
}
