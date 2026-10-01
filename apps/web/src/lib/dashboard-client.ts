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

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** `YYYY-MM` válido (mês 01 a 12). */
export function isValidMonth(ym: string): boolean {
  return MONTH_RE.test(ym);
}

/** Mês anterior ao de `today` (YYYY-MM-DD ou YYYY-MM), com a virada de ano: o último mês completo. */
export function previousMonthOf(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

/** `YYYY-MM` → `MM/AAAA`. */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${m}/${y}`;
}

/** `YYYY-MM` → "setembro de 2026". */
export function monthName(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} de ${y}`;
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

export type RangeError = "order" | "too-long" | null;

/** Por que um intervalo personalizado não vale (`null` = válido ou ainda incompleto). */
export function rangeError(from: string, to: string): RangeError {
  if (!isRealDate(from) || !isRealDate(to)) return null;
  if (from > to) return "order";
  return daysBetween(from, to) > MAX_RANGE_DAYS ? "too-long" : null;
}

/** Intervalo aceito pela API: datas reais, from <= to e no máximo 1100 dias. */
export function isValidRange(from: string, to: string): boolean {
  return isRealDate(from) && isRealDate(to) && rangeError(from, to) === null;
}

function first(v: RouteQuery[string]): string {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x.trim() : "";
}

/**
 * Lê o filtro da query da rota. Valores inválidos voltam ao padrão (mês anterior ao de `today`, o último completo, e entidade `all`); havendo mais de um
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
  if (isValidRange(from, to)) return { ...base, from, to };
  return { ...base, month: previousMonthOf(today) };
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

/**
 * Parâmetros dos endpoints `/dashboard/*` (mesmos nomes da API; nunca valores vazios, um único tipo de período).
 * `asOf` leva o "hoje" do navegador, para o servidor (UTC) não virar o dia antes do fuso local.
 */
export function filterToParams(f: PainelFilter, today: string = localToday()): URLSearchParams {
  const params = new URLSearchParams(filterToQuery(f));
  params.set("asOf", today);
  return params;
}

/** Só entidade e conta (mais `asOf`): `cards` e `cashflow` ignoram o período. */
export function scopeToParams(f: PainelFilter, today: string = localToday()): URLSearchParams {
  return filterToParams({ entity: f.entity, accountId: f.accountId }, today);
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

export type TransactionsLink = { path: "/transacoes"; query: Record<string, string> };

/**
 * Link para a lista de transações com o período, a entidade e a conta do filtro (e o que mais o clique pedir).
 * `type` + `reportable` reproduzem a regra de despesa dos dashboards (sem pares de transferência nem ignorados).
 */
export function transactionsLink(
  f: PainelFilter,
  extra: { categoryId?: string; from?: string; to?: string; type?: "income" | "expense"; reportable?: boolean } = {},
  today: string = localToday(),
): TransactionsLink {
  const range = periodRange(f, today);
  const query: Record<string, string> = { from: extra.from ?? range.from, to: extra.to ?? range.to };
  if (f.entity !== "all") query.entity = f.entity;
  if (f.accountId) query.accountId = f.accountId;
  if (extra.categoryId) query.categoryId = extra.categoryId;
  if (extra.type) query.type = extra.type;
  if (extra.reportable) query.reportable = "1";
  return { path: "/transacoes", query };
}

/** Primeiro e último dia de um mês YYYY-MM. */
export function monthRange(ym: string): { from: string; to: string } {
  return { from: `${ym}-01`, to: `${ym}-${pad(lastDayOfMonth(ym))}` };
}

/** Despesas de uma categoria (`"__none"` = sem categoria) no período do filtro, ou num mês específico. */
export function categoryLink(f: PainelFilter, categoryId: string, month?: string, today?: string): TransactionsLink {
  return transactionsLink(f, { categoryId, type: "expense", reportable: true, ...(month ? monthRange(month) : {}) }, today);
}

/** Despesas de todas as categorias num mês (fatia "Outras" do empilhado). */
export function expensesMonthLink(f: PainelFilter, month: string, today?: string): TransactionsLink {
  return transactionsLink(f, { type: "expense", reportable: true, ...monthRange(month) }, today);
}

/** Todos os lançamentos de um mês, no escopo (entidade/conta) do filtro. */
export function monthLink(f: PainelFilter, month: string, today?: string): TransactionsLink {
  return transactionsLink(f, monthRange(month), today);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Primeiro dia do ciclo cujo fechamento é `closingDate`: dia seguinte ao fechamento do mês anterior (dia limitado ao fim do mês). */
export function cycleStart(closingDate: string, closingDay: number): string {
  const [y, m] = closingDate.split("-").map(Number);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const prevYm = `${prev.y}-${pad(prev.m)}`;
  const day = Math.min(closingDay, lastDayOfMonth(prevYm));
  return addDays(`${prevYm}-${pad(day)}`, 1);
}

/** Lançamentos do ciclo atual de um cartão (início do ciclo até o fechamento), só da conta do cartão. */
export function cardCycleLink(card: { accountId: string; closingDate: string; closingDay: number }): TransactionsLink {
  return transactionsLink(
    { entity: "all", accountId: card.accountId },
    { from: cycleStart(card.closingDate, card.closingDay), to: card.closingDate },
  );
}
