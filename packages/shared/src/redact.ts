const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const LONG_DIGITS = /\d{6,}/g;

/** Mascara CNPJ, CPF e sequências longas de dígitos (contas, boletos, chaves) antes de enviar texto a um LLM externo. */
export function redactForLlm(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(CNPJ, "###").replace(CPF, "###").replace(LONG_DIGITS, "###");
}
