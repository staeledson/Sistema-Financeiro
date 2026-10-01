export interface ThemeColors {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  income: string;
  expense: string;
  transfer: string;
  pf: string;
  pj: string;
  danger: string;
  warning: string;
  fontSans: string;
}

// Fallbacks = tema claro de tokens.css (usados quando não há DOM/CSS, ex.: testes).
const FALLBACK: ThemeColors = {
  bg: "#f6f5f2",
  surface: "#ffffff",
  surface2: "#efede8",
  border: "#e2dfd8",
  text: "#25231f",
  textMuted: "#6f6b62",
  accent: "#2f6f5e",
  income: "#2a7352",
  expense: "#b23f34",
  transfer: "#5a6a80",
  pf: "#3a68a8",
  pj: "#94601f",
  danger: "#c2362b",
  warning: "#8f5f12",
  fontSans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

const VARS: Record<keyof ThemeColors, string> = {
  bg: "--bg",
  surface: "--surface",
  surface2: "--surface-2",
  border: "--border",
  text: "--text",
  textMuted: "--text-muted",
  accent: "--accent",
  income: "--c-income",
  expense: "--c-expense",
  transfer: "--c-transfer",
  pf: "--c-pf",
  pj: "--c-pj",
  danger: "--danger",
  warning: "--warning",
  fontSans: "--font-sans",
};

/** Lê as variáveis CSS do tema atual (claro/escuro) para uso em gráficos. */
export function themeColors(): ThemeColors {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return { ...FALLBACK };
  const style = getComputedStyle(document.documentElement);
  const out = { ...FALLBACK };
  for (const key of Object.keys(VARS) as Array<keyof ThemeColors>) {
    const v = style.getPropertyValue(VARS[key]).trim();
    if (v) out[key] = v;
  }
  return out;
}
