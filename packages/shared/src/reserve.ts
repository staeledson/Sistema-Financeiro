import { foldText } from "./categorization";
import type { TransactionType } from "./enums";

/** Guardar na reserva sai da conta (despesa no extrato): "Reserva por gastos…" e "Reserva programada…" do Mercado Pago. */
const TO_RESERVE = /^reserva (por gastos|programada)\b/;
/** Retirar da reserva entra na conta (receita no extrato): "Dinheiro retirado Reserva…". */
const FROM_RESERVE = /^dinheiro retirado reserva\b/;

/**
 * Movimento entre a conta e a reserva do próprio titular, pelo texto do extrato. O sentido do lançamento tem de bater
 * (guardar = despesa, retirar = receita); qualquer outro caso não é reserva. A reserva vira uma conta e o movimento,
 * uma transferência, para não inflar despesas nem receitas.
 */
export function reserveDirection(
  type: TransactionType,
  description: string | null | undefined,
): "to_reserve" | "from_reserve" | null {
  const text = foldText(description ?? "").trim();
  if (type === "expense" && TO_RESERVE.test(text)) return "to_reserve";
  if (type === "income" && FROM_RESERVE.test(text)) return "from_reserve";
  return null;
}
