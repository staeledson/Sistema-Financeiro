import { foldText, normalizeDescriptionKey } from "./categorization";

export type Rule = {
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  categoryId: string;
  priority: number;
};

/** Regex salva pelo usuário pode ser inválida: nesse caso simplesmente não casa (nunca derruba o lote). */
function regexHit(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}

/** Padrão já em forma de chave (minúsculas, sem acento/dígito/pontuação): também casa com a chave do texto. */
function isKeyForm(folded: string): boolean {
  return folded !== "" && folded === normalizeDescriptionKey(folded);
}

/**
 * Regra de maior prioridade que casa com o texto (com todos os seus campos, inclusive id).
 * `contains`/`equals` ignoram acento e caixa; um padrão em forma de chave (como os gerados por `ruleFromCorrection`)
 * também casa contra a chave do texto, para "netflix com" casar "Netflix.com 02/2026". `regex` roda sobre o texto cru.
 */
export function matchRule<T extends Rule>(text: string, rules: T[]): T | null {
  const t = foldText(text);
  const key = normalizeDescriptionKey(text);
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    const p = foldText(r.pattern);
    const hit =
      r.matchType === "equals"
        ? t === p
        : r.matchType === "contains"
          ? t.includes(p) || (isKeyForm(p) && key.includes(p))
          : regexHit(r.pattern, text);
    if (hit) return r;
  }
  return null;
}

export function applyRules(text: string, rules: Rule[]): string | null {
  return matchRule(text, rules)?.categoryId ?? null;
}

/** Prefixos de operação bancária (sobre a chave normalizada) que não identificam o fornecedor. */
const OPERATION_PREFIX = new RegExp(
  "^(?:" +
    [
      "pix (?:enviado|enviada|recebido|recebida)(?: (?:para|de|a))?",
      "pix (?:para|de)",
      "compra(?: no)?(?: debito| credito)?",
      "pagamento(?: (?:de|a|em))?",
      "pag",
      "ted(?: (?:enviada|enviado|recebida|recebido))?",
      "doc",
      "transferencia(?: (?:enviada|enviado|recebida|recebido))?(?: (?:para|de))?",
      "debito automatico",
      "deb aut",
    ].join("|") +
    ")(?= |$) ?",
);

/** Palavras que descrevem só a operação: um padrão feito delas casaria com quase tudo. */
const GENERIC_WORDS = new Set([
  "pix", "ted", "doc", "pagamento", "pagto", "pag", "compra", "transferencia", "debito", "credito", "boleto",
  "saque", "deposito", "enviado", "enviada", "recebido", "recebida", "automatico", "cartao", "de", "do", "da", "para", "em", "no", "a",
]);

const MIN_PATTERN_LENGTH = 4;

/**
 * Regra `contains` aprendida de uma correção: usa a chave normalizada do fornecedor (ou da descrição), sem prefixos de
 * operação bancária, limitada a 3 palavras. Devolve `null` quando nada identificador sobra (vazio, curto ou genérico).
 */
export function ruleFromCorrection(
  tx: { counterparty?: string | null; description?: string | null },
  categoryId: string,
): Rule | null {
  let key = normalizeDescriptionKey(tx.counterparty) || normalizeDescriptionKey(tx.description);
  for (;;) {
    const next = key.replace(OPERATION_PREFIX, "");
    if (next === key) break;
    key = next;
  }
  const words = key.split(" ").filter(Boolean).slice(0, 3);
  const pattern = words.join(" ");
  if (pattern.length < MIN_PATTERN_LENGTH) return null;
  if (words.every((w) => GENERIC_WORDS.has(w))) return null;
  return { matchType: "contains", pattern, categoryId, priority: 120 };
}
