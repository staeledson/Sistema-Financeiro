/**
 * Lista de permissão de cadastro. `allowedEnv` é o valor de SIGNUP_ALLOWED_EMAILS
 * (emails separados por vírgula). Ausente ou vazio: qualquer email pode se cadastrar
 * (desenvolvimento e testes); com valor: só os listados, sem diferenciar maiúsculas.
 */
export function isSignupAllowed(email: string, allowedEnv: string | undefined): boolean {
  const allowed = (allowedEnv ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(email.trim().toLowerCase());
}

/** Converte TRUSTED_ORIGINS (URLs separadas por vírgula) em origens http/https sem barra final. */
export function parseTrustedOrigins(env: string | undefined): string[] {
  return (env ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\/\S+$/i.test(item) && URL.canParse(item))
    .map((item) => item.replace(/\/+$/, ""));
}
