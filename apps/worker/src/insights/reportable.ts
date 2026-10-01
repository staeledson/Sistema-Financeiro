import { Prisma } from "../../generated/prisma/client";

/** Fragmento de SQL dos lançamentos que entram em receita/despesa: fora transferências pareadas e ignorados; `alias` é o alias da tabela `transactions` na consulta (se houver). */
export function reportableSql(alias?: "t") {
  const col = (name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
  return Prisma.sql`AND ${col("transferPairId")} IS NULL AND ${col("ignored")} = false`;
}
