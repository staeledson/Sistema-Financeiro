export type Rule = {
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  categoryId: string;
  priority: number;
};

export function applyRules(text: string, rules: Rule[]): string | null {
  const t = text.toLowerCase();
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    const p = r.pattern.toLowerCase();
    const hit =
      r.matchType === "equals"
        ? t === p
        : r.matchType === "contains"
          ? t.includes(p)
          : new RegExp(r.pattern, "i").test(text);
    if (hit) return r.categoryId;
  }
  return null;
}

export function ruleFromCorrection(
  tx: { counterparty?: string | null; description?: string | null },
  categoryId: string,
): Rule {
  const base = (tx.counterparty ?? tx.description ?? "").trim().toLowerCase();
  const pattern = base.split(/\s+/).slice(0, 3).join(" ") || base;
  return { matchType: "contains", pattern, categoryId, priority: 120 };
}
