const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NBSP = "\u00a0";

/** Normaliza para centavos inteiros e elimina -0 (que o Intl mostraria como "-R$ 0,00"). */
function wholeCents(cents: number): number {
  return Math.round(cents) || 0;
}

/** Centavos → "R$ 1.234,56" (negativo com sinal; espaço não separável entre R$ e o número). */
export function formatBRL(cents: number): string {
  // O Intl já usa U+00A0 depois de "R$"; normaliza qualquer outro espaço para ele.
  return BRL.format(wholeCents(cents) / 100).replace(/\s/g, NBSP);
}

/** Uma casa decimal só quando necessária: 2,5 mi / 120 mil. */
function compactNumber(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Centavos → "R$ 1,2 mil" / "R$ 3,4 mi"; abaixo de R$ 1.000 usa o formato completo. Arredonda antes de escolher a unidade. */
export function formatBRLCompact(cents: number): string {
  const whole = wholeCents(cents);
  const abs = Math.abs(whole);
  const sign = whole < 0 ? "-" : "";
  const out = (n: number, unit: string) => `${sign}R$${NBSP}${compactNumber(n)} ${unit}`;
  if (abs >= 1_000_000_00) return out(round1(abs / 1_000_000_00), "mi");
  if (abs >= 1_000_00) {
    const mil = round1(abs / 1_000_00);
    // 999,95 mil arredonda para 1.000 mil, que é 1 mi
    return mil >= 1000 ? out(round1(abs / 1_000_000_00), "mi") : out(mil, "mil");
  }
  return formatBRL(whole);
}

export function signedClass(cents: number): "pos" | "neg" | "zero" {
  if (cents > 0) return "pos";
  if (cents < 0) return "neg";
  return "zero";
}
