import { Prisma } from "../../generated/prisma/client";

/** Filtro Prisma dos lançamentos que entram em receita/despesa: fora transferências pareadas e ignorados. */
export const REPORTABLE = { transferPairId: null, ignored: false } as const;

/** O mesmo filtro como fragmento de SQL; `alias` é o alias da tabela `transactions` na consulta (se houver). */
export function reportableSql(alias?: string) {
  const col = (name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
  return Prisma.sql`AND ${col("transferPairId")} IS NULL AND ${col("ignored")} = false`;
}
