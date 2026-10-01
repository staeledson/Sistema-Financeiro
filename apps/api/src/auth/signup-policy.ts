/** Mensagem única de recusa de cadastro (o teste de fumaça procura por ela). */
export const SIGNUP_DENIED_MESSAGE = "Cadastro não permitido.";

export type SignupMode =
  | { mode: "allowlist"; count: number }
  | { mode: "aberto" }
  | { mode: "fechado" };

function parseList(allowedEnv: string | undefined): string[] {
  return (allowedEnv ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Modo de cadastro, a partir de SIGNUP_ALLOWED_EMAILS (emails separados por vírgula) e NODE_ENV.
 * - Valor exatamente "*": cadastro aberto (opt-in explícito).
 * - Lista com emails: só os listados.
 * - Ausente/vazio fora de produção: aberto (desenvolvimento e testes).
 * - Ausente/vazio em produção: FECHADO (falha segura).
 * `nodeEnv` é lido a cada chamada para poder ser alterado nos testes.
 */
export function signupMode(
  allowedEnv: string | undefined,
  nodeEnv: string | undefined = process.env["NODE_ENV"],
): SignupMode {
  if ((allowedEnv ?? "").trim() === "*") return { mode: "aberto" };
  const list = parseList(allowedEnv);
  if (list.length > 0) return { mode: "allowlist", count: list.length };
  return nodeEnv === "production" ? { mode: "fechado" } : { mode: "aberto" };
}

/** Descrição do modo para o log de boot (nunca inclui os emails). */
export function describeSignupMode(m: SignupMode): string {
  if (m.mode === "allowlist") return `allowlist (${m.count} emails)`;
  return m.mode === "aberto" ? "aberto (*)" : "fechado";
}

export function isSignupAllowed(
  email: string,
  allowedEnv: string | undefined,
  nodeEnv: string | undefined = process.env["NODE_ENV"],
): boolean {
  const m = signupMode(allowedEnv, nodeEnv);
  if (m.mode === "aberto") return true;
  if (m.mode === "fechado") return false;
  return parseList(allowedEnv).includes(email.trim().toLowerCase());
}

/** Converte TRUSTED_ORIGINS (URLs separadas por vírgula) em origens http/https sem barra final. */
export function parseTrustedOrigins(env: string | undefined): string[] {
  return (env ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\/\S+$/i.test(item) && URL.canParse(item))
    .map((item) => item.replace(/\/+$/, ""));
}
