import type { BalancePoint, ParsedRow } from "./types";

export interface BalanceMismatch {
  dateISO: string;
  expectedCents: number;
  computedCents: number;
  /** esperado − calculado */
  diffCents: number;
}

export interface BalanceCheck {
  ok: boolean;
  checkedAt: string;
  /** Quantos intervalos foram conferidos (pontos de saldo − 1). */
  checkpoints: number;
  mismatches: BalanceMismatch[];
}

const signed = (r: Pick<ParsedRow, "type" | "amountCents">) => (r.type === "income" ? r.amountCents : -r.amountCents);

/**
 * Confere o extrato contra os saldos que ele mesmo declara. Para cada par de pontos consecutivos,
 * saldo calculado = saldo anterior + soma das linhas com data contábil (ou de lançamento, se não houver)
 * em (data anterior, data atual]. O primeiro ponto é a âncora e não é verificado.
 * Regras de preparação dos pontos:
 *  - duplicatas exatas (mesma data, saldo e marca `current`) são removidas antes de tudo;
 *  - ordenação por data; na mesma data o ponto `current` vem DEPOIS do não-`current`;
 *  - só o ÚLTIMO ponto, e somente se for `current` (saldo corrente, momento da exportação, que já inclui
 *    lançamentos com data contábil futura), soma toda linha com data > data anterior, SEM limite superior;
 *    um `current` em qualquer outra posição é tratado como ponto comum (limitado pela sua data).
 * `checkpoints` é (pontos − 1) contado após a deduplicação.
 * Devolve null quando o arquivo traz menos de dois pontos.
 */
export function verifyBalances(
  rows: Pick<ParsedRow, "type" | "amountCents" | "date" | "postedDate">[],
  balances: BalancePoint[],
  now: Date = new Date(),
): BalanceCheck | null {
  if (balances.length < 2) return null;
  const seen = new Set<string>();
  const unique = balances.filter((p) => {
    const key = `${p.dateISO}|${p.balanceCents}|${p.current === true ? 1 : 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const points = unique.sort(
    (a, b) => a.dateISO.localeCompare(b.dateISO) || Number(!!a.current) - Number(!!b.current),
  );
  if (points.length < 2) return null;
  const mismatches: BalanceMismatch[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const unbounded = cur.current === true && i === points.length - 1;
    let computed = prev.balanceCents;
    for (const r of rows) {
      const d = r.postedDate ?? r.date;
      if (d > prev.dateISO && (unbounded || d <= cur.dateISO)) computed += signed(r);
    }
    if (computed !== cur.balanceCents) {
      mismatches.push({
        dateISO: cur.dateISO,
        expectedCents: cur.balanceCents,
        computedCents: computed,
        diffCents: cur.balanceCents - computed,
      });
    }
  }
  return { ok: mismatches.length === 0, checkedAt: now.toISOString(), checkpoints: points.length - 1, mismatches };
}
