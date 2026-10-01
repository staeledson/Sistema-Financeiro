import { formatBRL } from "./money";

const MINUS = "[-−]"; // hífen ou sinal de menos tipográfico
const GROUP3 = /^\d{1,3}(?:SEP\d{3})*$/;
const grouped = (sep: "." | ","): RegExp => new RegExp(GROUP3.source.replace(/SEP/g, sep === "." ? "\\." : ","));
const DOTS_GROUPED = grouped(".");
const COMMAS_GROUPED = grouped(",");

/**
 * Texto digitado em reais → centavos inteiros; `null` quando não dá para ler com segurança.
 *
 * Regras (pt-BR primeiro):
 *  - sinal opcional (`-`, `−` ou `+`) e prefixo `R$` opcional, em qualquer ordem ("-R$ 5,00", "R$ -5,00"); espaços são ignorados;
 *  - vírgula e ponto juntos: o ÚLTIMO é o separador decimal e o outro, de milhar ("1.234,56" e "1,234.56");
 *  - só vírgula: é decimal ("16,59"); mais de uma vírgula é ambíguo e é rejeitado ("1,234" também: 3 casas);
 *  - só ponto: com 1 ou 2 dígitos depois do último é decimal ("1234.56", "16.5"); quando o texto é
 *    exatamente grupos de 3 dígitos ("1.234", "1.234.567") o ponto é milhar, como no Brasil;
 *  - sem separador: reais inteiros ("120" = R$ 120,00);
 *  - milhar só vale em grupos corretos (1 a 3 dígitos, depois grupos de 3); parte inteira obrigatória ("0,50", não ",50");
 *  - no máximo 2 casas decimais; nunca arredonda; valor além do inteiro seguro em centavos é rejeitado.
 */
export function parseMoneyInput(text: string): number | null {
  let s = text.replace(/\s+/g, "");
  let negative = false;
  let signs = 0;
  const takeSign = (): void => {
    const c = s[0];
    if (c === "-" || c === "\u2212" || c === "+") {
      negative = c !== "+";
      s = s.slice(1);
      signs++;
    }
  };
  takeSign();
  s = s.replace(/^R\$/i, "");
  takeSign();
  if (signs > 1 || !/^[\d.,]+$/.test(s)) return null;

  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let intPart = s;
  let decPart = "";
  let hasDecimal = false;

  if (lastDot >= 0 && lastComma >= 0) {
    const decSep = lastDot > lastComma ? "." : ",";
    const thouSep = decSep === "." ? "," : ".";
    const idx = Math.max(lastDot, lastComma);
    const left = s.slice(0, idx);
    if (left.includes(decSep) || !(thouSep === "." ? DOTS_GROUPED : COMMAS_GROUPED).test(left)) return null;
    intPart = left.split(thouSep).join("");
    decPart = s.slice(idx + 1);
    hasDecimal = true;
  } else if (lastComma >= 0) {
    if (s.indexOf(",") !== lastComma) return null;
    intPart = s.slice(0, lastComma);
    decPart = s.slice(lastComma + 1);
    hasDecimal = true;
  } else if (lastDot >= 0) {
    if (DOTS_GROUPED.test(s) && !s.startsWith("0")) {
      intPart = s.split(".").join("");
    } else {
      if (s.indexOf(".") !== lastDot) return null;
      intPart = s.slice(0, lastDot);
      decPart = s.slice(lastDot + 1);
      hasDecimal = true;
    }
  }

  if (!/^\d+$/.test(intPart)) return null;
  if (hasDecimal && !/^\d{1,2}$/.test(decPart)) return null;

  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents || 0 : cents;
}

/** "+R$ 3,58" / "−R$ 63,41" / "R$ 0,00 (sem ajuste)": o ajuste de saldo inicial que a conciliação fará. */
export function formatAdjustment(cents: number): string {
  if (cents === 0) return `${formatBRL(0)} (sem ajuste)`;
  return `${cents > 0 ? "+" : "−"}${formatBRL(Math.abs(cents))}`;
}
