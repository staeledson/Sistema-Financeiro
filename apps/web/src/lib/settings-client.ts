/**
 * Formulário de Ajustes: conversão dos nomes (texto ↔ lista) e validação com as mesmas faixas do
 * `workspaceSettingsSchema` da API (o web não depende de `@app/shared`).
 */

export const SETTINGS_LIMITS = {
  threshold: { min: 0, max: 1 },
  batchSize: { min: 1, max: 200 },
  windowDays: { min: 0, max: 10 },
  maxOwnerNames: 20,
} as const;

export interface SettingsForm {
  aiConfidenceThreshold: number;
  aiBatchSize: number;
  transferMatchWindowDays: number;
  ownerNames: string[];
}

export type SettingsErrors = Partial<Record<keyof SettingsForm, string>>;

export type SettingsValidation =
  | { ok: true; value: SettingsForm }
  | { ok: false; errors: SettingsErrors };

/**
 * Separa por vírgula ou quebra de linha; tira espaços, vazios e repetidos (sem diferenciar maiúsculas); no máximo 20.
 * O formulário passa `Infinity` em `limit` para que `validateSettingsForm` recuse listas longas em vez de cortá-las.
 */
export function parseOwnerNames(text: string, limit: number = SETTINGS_LIMITS.maxOwnerNames): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n\r]+/)) {
    const name = part.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("pt-BR");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

/** Um nome por linha. */
export function formatOwnerNames(names: string[]): string {
  return names.join("\n");
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function validateSettingsForm(form: SettingsForm): SettingsValidation {
  const errors: SettingsErrors = {};
  const { threshold, batchSize, windowDays, maxOwnerNames } = SETTINGS_LIMITS;

  if (!isNum(form.aiConfidenceThreshold) || form.aiConfidenceThreshold < threshold.min || form.aiConfidenceThreshold > threshold.max) {
    errors.aiConfidenceThreshold = "Informe um valor entre 0 e 1.";
  }
  if (!isNum(form.aiBatchSize) || !Number.isInteger(form.aiBatchSize) || form.aiBatchSize < batchSize.min || form.aiBatchSize > batchSize.max) {
    errors.aiBatchSize = "Informe um número inteiro entre 1 e 200.";
  }
  if (
    !isNum(form.transferMatchWindowDays) || !Number.isInteger(form.transferMatchWindowDays) ||
    form.transferMatchWindowDays < windowDays.min || form.transferMatchWindowDays > windowDays.max
  ) {
    errors.transferMatchWindowDays = "Informe um número inteiro de dias entre 0 e 10.";
  }
  if (form.ownerNames.length > maxOwnerNames) {
    errors.ownerNames = `Informe no máximo ${maxOwnerNames} nomes.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { ...form, ownerNames: [...form.ownerNames] } };
}

export const FORBIDDEN_SETTINGS_MESSAGE = "Somente o dono ou administradores do workspace podem alterar os ajustes.";

/** Mensagem do erro ao salvar: o 403 da API vem em inglês técnico, então é trocado por texto pt-BR. */
export function settingsErrorMessage(e: unknown): string {
  if ((e as { status?: unknown } | null)?.status === 403) return FORBIDDEN_SETTINGS_MESSAGE;
  return e instanceof Error && e.message ? e.message : "Não foi possível salvar.";
}
