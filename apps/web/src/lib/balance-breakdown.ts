import type { SummaryAccount } from "./api";
import { ENTITY_LABEL, type AccountEntity } from "./entity";

export type BreakdownKind = "pf" | "pj" | "total" | "cards";

export interface BreakdownGroup {
  label: string;
  entity?: AccountEntity;
  subtotalCents: number;
  accounts: SummaryAccount[];
}

export interface Breakdown {
  title: string;
  totalCents: number;
  groups: BreakdownGroup[];
}

const TITLE: Record<BreakdownKind, string> = {
  pf: "Pessoa Física",
  pj: "Pessoa Jurídica",
  total: "Saldo total em contas",
  cards: "Cartões a pagar",
};

const ENTITIES: AccountEntity[] = ["pf", "pj"];

const isCard = (a: SummaryAccount) => a.type === "credit_card";

/** Maior valor absoluto primeiro (o que mais pesa no número); empate pelo nome. Contas zeradas ficam no fim. */
function byWeight(a: SummaryAccount, b: SummaryAccount): number {
  return Math.abs(b.balanceCents) - Math.abs(a.balanceCents) || a.name.localeCompare(b.name, "pt-BR");
}

function group(entity: AccountEntity, accounts: SummaryAccount[]): BreakdownGroup | null {
  const own = accounts.filter((a) => a.entity === entity).sort(byWeight);
  if (own.length === 0) return null;
  return { label: ENTITY_LABEL[entity], entity, subtotalCents: own.reduce((s, a) => s + a.balanceCents, 0), accounts: own };
}

/**
 * O que compõe cada número dos saldos do Início: pf/pj/total = contas de caixa (sem cartão) por entidade;
 * cards = os cartões de crédito (dívida, saldo negativo) por entidade. Grupos sem conta são omitidos.
 */
export function breakdownFor(kind: BreakdownKind, accounts: SummaryAccount[]): Breakdown {
  const pool = kind === "cards" ? accounts.filter(isCard) : accounts.filter((a) => !isCard(a));
  const entities = kind === "pf" || kind === "pj" ? [kind] : ENTITIES;
  const groups = entities.map((e) => group(e, pool)).filter((g): g is BreakdownGroup => g !== null);
  return { title: TITLE[kind], totalCents: groups.reduce((s, g) => s + g.subtotalCents, 0), groups };
}
