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

/** Regra de maior prioridade que casa com o texto (com todos os seus campos, inclusive id). */
export function matchRule<T extends Rule>(text: string, rules: T[]): T | null {
  const t = text.toLowerCase();
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    const p = r.pattern.toLowerCase();
    const hit =
      r.matchType === "equals"
        ? t === p
        : r.matchType === "contains"
          ? t.includes(p)
          : regexHit(r.pattern, text);
    if (hit) return r;
  }
  return null;
}

export function applyRules(text: string, rules: Rule[]): string | null {
  return matchRule(text, rules)?.categoryId ?? null;
}

export function ruleFromCorrection(
  tx: { counterparty?: string | null; description?: string | null },
  categoryId: string,
): Rule {
  const base = (tx.counterparty ?? tx.description ?? "").trim().toLowerCase();
  const pattern = base.split(/\s+/).slice(0, 3).join(" ") || base;
  return { matchType: "contains", pattern, categoryId, priority: 120 };
}
