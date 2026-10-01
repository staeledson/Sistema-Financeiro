import { foldText } from "../categorization";

/**
 * Categoria que o banco manda na fatura (tipo de comerciante) → nome de categoria nossa (seed).
 * Pares `[regex sobre foldText, nome]`; o primeiro que casar vence. "Elétrico" (código de comerciante)
 * propositalmente não mapeia: não é conta de luz.
 */
const BANK_CATEGORY_MAP: Array<[RegExp, string]> = [
  [/restaurante|lanchonete|\bbar\b|padaria|delivery|fast ?food/, "Restaurantes e delivery"],
  [/supermercado|mercearia|hipermercado/, "Supermercado"],
  [/farmaci|drogari/, "Farmácia"],
  [/assistencia medica|odontolog|hospital|clinica|laboratorio|medic/, "Saúde"],
  [/telecomunica|telefon|internet|energia|agua e esgoto|gas encanado/, "Contas e utilidades"],
  [/tv por assinatura|radio|streaming|assinatura/, "Assinaturas"],
  [/educa|escola|curso|universidade|faculdade|livraria/, "Educação"],
  [/combustiv|\bpostos?\b/, "Combustível"],
  [/taxi|transporte|pedagio|estacionamento|onibus|metro|aplicativo de transporte/, "Transporte"],
  [/vestuario|loja de departamento|lojas de departamento|eletronic|calcado|moveis|utilidades domesticas|joalheria/, "Compras"],
  [/entretenimento|cinema|teatro|hotel|hotei|companhia aerea|companhias aereas|agencia de viagem|agencias de viagem|turismo|recreacao|clube/, "Lazer"],
  [/veterinari|pet ?shop|\bpet\b|animais/, "Pets"],
  [/imposto|taxa governamental|governo/, "Impostos e taxas"],
];

export function mapBankCategory(bankCategory: string | null | undefined): string | null {
  const folded = foldText(bankCategory ?? "").trim();
  if (!folded || folded === "-") return null;
  for (const [pattern, name] of BANK_CATEGORY_MAP) if (pattern.test(folded)) return name;
  return null;
}
