/**
 * Filtro global do Painel: estado na URL (`route.query`), validação e conversão para os parâmetros dos endpoints
 * `GET /dashboard/*` e para o link da lista de transações. Espelha as regras do `dashboardFilterSchema` da API
 * (o web não depende de `@app/shared`).
 */

export type PainelEntity = "all" | "pf" | "pj";

export type PainelFilter = {
  entity: PainelEntity;
  /** Vazio quando não há conta escolhida. */
  accountId: string;
  month?: string;
  quarter?: string;
  year?: string;
  from?: string;
  to?: string;
};

export type RouteQuery = Record<string, string | string[] | null | undefined | (string | null)[]>;

const MONTH_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^(19|20)\d{2}-Q[1-4]$/;
const YEAR_RE = /^(19|20)\d{2}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 1100;

const pad = (n: number) => String(n).padStart(2, "0");

/** Hoje (data local do navegador) em YYYY-MM-DD. */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isRealDate(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function lastDayOfMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function first(v: RouteQuery[string]): string {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x.trim() : "";
}

/**
 * Lê o filtro da query da rota. Valores inválidos voltam ao padrão (mês de `today`, entidade `all`); havendo mais de um
 * tipo de período válido, vale o primeiro na ordem mês, trimestre, ano, intervalo.
 */
export function filterFromQuery(query: RouteQuery, today: string = localToday()): PainelFilter {
  const rawEntity = first(query.entity);
  const entity: PainelEntity = rawEntity === "pf" || rawEntity === "pj" ? rawEntity : "all";
  const base = { entity, accountId: first(query.accountId) };

  const month = first(query.month);
  if (MONTH_RE.test(month)) return { ...base, month };
  const quarter = first(query.quarter);
  if (QUARTER_RE.test(quarter)) return { ...base, quarter };
  const year = first(query.year);
  if (YEAR_RE.test(year)) return { ...base, year };
  const from = first(query.from);
  const to = first(query.to);
  if (isRealDate(from) && isRealDate(to) && from <= to && daysBetween(from, to) <= MAX_RANGE_DAYS) {
    return { ...base, from, to };
  }
  return { ...base, month: today.slice(0, 7) };
}

/** Query da rota: omite vazios e `entity=all`. */
export function filterToQuery(f: PainelFilter): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.entity !== "all") out.entity = f.entity;
  if (f.accountId) out.accountId = f.accountId;
  if (f.month) out.month = f.month;
  else if (f.quarter) out.quarter = f.quarter;
  else if (f.year) out.year = f.year;
  else if (f.from && f.to) {
    out.from = f.from;
    out.to = f.to;
  }
  return out;
}

/** Parâmetros dos endpoints `/dashboard/*` (mesmos nomes da API; nunca valores vazios, um único tipo de período). */
export function filterToParams(f: PainelFilter): URLSearchParams {
  return new URLSearchParams(filterToQuery(f));
}

/** Só entidade e conta: `cards` e `cashflow` ignoram o período. */
export function scopeToParams(f: PainelFilter): URLSearchParams {
  return filterToParams({ entity: f.entity, accountId: f.accountId });
}

/** Primeiro e último dia do período do filtro. */
export function periodRange(f: PainelFilter, today: string = localToday()): { from: string; to: string } {
  if (f.from && f.to) return { from: f.from, to: f.to };
  if (f.year) return { from: `${f.year}-01-01`, to: `${f.year}-12-31` };
  if (f.quarter) {
    const [y, q] = f.quarter.split("-Q");
    const startMonth = (Number(q) - 1) * 3 + 1;
    const endYm = `${y}-${pad(startMonth + 2)}`;
    return { from: `${y}-${pad(startMonth)}-01`, to: `${endYm}-${pad(lastDayOfMonth(endYm))}` };
  }
  const ym = f.month ?? today.slice(0, 7);
  return { from: `${ym}-01`, to: `${ym}-${pad(lastDayOfMonth(ym))}` };
}

/** Link para a lista de transações com o período, a entidade e a conta do filtro (e o que mais o clique pedir). */
export function transactionsLink(
  f: PainelFilter,
  extra: { categoryId?: string; from?: string; to?: string } = {},
  today: string = localToday(),
): { path: "/transacoes"; query: Record<string, string> } {
  const range = periodRange(f, today);
  const query: Record<string, string> = { from: extra.from ?? range.from, to: extra.to ?? range.to };
  if (f.entity !== "all") query.entity = f.entity;
  if (f.accountId) query.accountId = f.accountId;
  if (extra.categoryId) query.categoryId = extra.categoryId;
  return { path: "/transacoes", query };
}
