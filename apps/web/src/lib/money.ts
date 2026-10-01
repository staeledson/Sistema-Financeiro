const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Centavos → "R$ 1.234,56" (negativo com sinal). */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, " ");
}

function compactNumber(n: number): string {
  // uma casa decimal só quando necessária: 2,5 mi / 120 mil
  const rounded = Math.round(n * 10) / 10;
  return rounded.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** Centavos → "R$ 1,2 mil" / "R$ 3,4 mi"; abaixo de R$ 1.000 usa o formato completo. */
export function formatBRLCompact(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  if (abs >= 1_000_000_00) return `${sign}R$ ${compactNumber(abs / 1_000_000_00)} mi`;
  if (abs >= 1_000_00) return `${sign}R$ ${compactNumber(abs / 1_000_00)} mil`;
  return formatBRL(cents);
}

export function signedClass(cents: number): "pos" | "neg" | "zero" {
  if (cents > 0) return "pos";
  if (cents < 0) return "neg";
  return "zero";
}
