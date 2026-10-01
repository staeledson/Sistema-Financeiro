# Fase 13 — Dashboards, visual novo e seguimentos da Fase 12 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o painel de dashboards (gasto por categoria, cartões e faturas, fluxo de caixa e previsão) com filtro global na URL, o resumo da tela inicial, o visual novo com roteador em todas as telas, e fechar os seguimentos da Fase 12 (selos e desfazer de pares/ignorados, tela de ajustes, teto de custo da IA, privacidade).

**Architecture:** Lógica pura e testável em `packages/shared` (período, recorrência, ciclo de fatura, parcelas, previsão). A API ganha um módulo de dashboards com agregação em SQL (`$queryRaw`), todo ele filtrado por `entity`/`accountId`/período resolvidos em data ISO no servidor (sem `NOW()` do banco). O web ganha `vue-router`, tokens de tema claro/escuro, componentes base e uma view `Painel` com ECharts; o estado do filtro vive na query string.

**Tech Stack:** NestJS 11 + Fastify 5, Prisma 7 (`$queryRaw` + `Prisma.sql`), Zod, BullMQ worker, Vue 3.5 + Pinia + vue-router 5 (já instalado) + ECharts 6 (já instalado), Vitest.

## Global Constraints

Copiados da spec `docs/superpowers/specs/2026-09-05-contas-pf-pj-import-ia-dashboards-design.md` (seções 6, 8 e 9) e das decisões já tomadas:

- Filtro global: `entity (pf|pj|all)`, `accountId?`, `period` (`month=YYYY-MM` | `quarter` | `year` | `from/to`). Persistido na URL. **Todos** os endpoints de dashboard aceitam os mesmos parâmetros.
- Regra de agregação: receita e despesa **excluem** `transferPairId != null`, `type = transfer` e `ignored = true` (`REPORTABLE` / `reportableSql("t")` de `apps/api/src/common/reportable.ts`). **Saldos não excluem** (decisão da Fase 12: o saldo reflete o banco; pares e ignorados continuam nos saldos).
- Rotas: `GET /dashboard/spending`, `GET /dashboard/cards`, `GET /dashboard/cashflow`, `GET /dashboard/summary`. O `GET /dashboard?month=` atual continua existindo (os e2e de agregação e o chat dependem do contrato dele).
- Recorrência: agrupa por descrição normalizada (minúsculas, sem dígitos, sem espaços duplicados); é recorrente se tiver ≥ 3 ocorrências, desvio de valor ≤ 15% e intervalo médio entre 25 e 35 dias (mensal) ou 6 e 8 dias (semanal).
- Cada gráfico é um card com título, valor de destaque, insight de uma linha (ex.: "Supermercado subiu 18% vs. mês anterior") e clique abrindo a lista de transações filtrada. ECharts 6 com tema claro/escuro.
- Prioridade dos blocos no Painel: 1) para onde vai o dinheiro, 2) cartões e faturas, 3) fluxo de caixa. "Saúde PJ" fora de escopo.
- Visual: neutro e polido, **não** o design system da PluralMed. Tokens em `apps/web/src/styles/tokens.css`: paleta neutra (cinzas quentes), cor de destaque única, semânticas `--c-income`, `--c-expense`, `--c-transfer`, `--c-pf`, `--c-pj`, claro e escuro via `prefers-color-scheme` e toggle manual; fonte do sistema, números com `font-variant-numeric: tabular-nums`. Componentes base em `apps/web/src/components/ui/`: `Card`, `DataTable`, `EntityBadge`, `PeriodPicker`, `FilterBar`, `Money`, `EmptyState`. Navegação lateral no desktop, barra inferior no celular. Rotas `/`, `/painel`, `/contas`, `/transacoes`, `/importar`, `/categorizar`, `/regras`, `/orcamentos`, `/metas`, `/membros`, `/chat`, `/lancar` (mais `/insights` e `/ajustes`, que já existem como telas/serão criadas).
- Sem dependências novas no web (nada de Tailwind ou biblioteca de componentes). O web **não** depende de `@app/shared`: a lógica compartilhada que o web precisa é consumida só por HTTP; o que for puro de UI fica em `apps/web/src/lib/`.
- Português do Brasil em toda a interface e em mensagens de erro. Valores em centavos (`amountCents`) em toda a API; formatação só no web.
- Portas e infraestrutura dedicadas já definidas (Postgres 5433, Redis 6380, API 3100); o banco `financas` é compartilhado entre dev e e2e e é limpo a cada execução dos e2e.
- Migrations geradas com `prisma migrate diff --from-schema <antigo> --to-schema ... --script`; a checagem de drift `prisma migrate diff --from-config-datasource --to-schema ...` deve imprimir "empty migration".
- Testes de e2e da API usam banco real, em série, e **não podem rodar ao mesmo tempo** (compartilham o banco).
- Nada de `NOW()` no SQL novo do dashboard: o "hoje" vem do servidor em ISO (`asOf` opcional nos endpoints, só para testes e viagem no tempo).

## Decisões e desvios da spec

1. **`asOf`**: todos os endpoints de dashboard aceitam `asOf=YYYY-MM-DD` opcional (padrão: hoje no servidor). Serve aos testes com valores calculados à mão e resolve a dependência do fuso do banco no dashboard. O worker de insights continua usando `NOW()` (pendência conhecida).
2. **Saldos**: a spec (§3.2) diz que saldo também exclui pares/ignorados; a Fase 12 decidiu o contrário e foi entregue assim. Mantido: só receita/despesa excluem. `BalancesService` passa a calcular em SQL, com entidade, e é reutilizado pelo cashflow e pelo `get_balance` do chat.
3. **Parcelas**: `installmentCurrent`/`installmentTotal` entram agora (estavam na spec §3.2 e foram adiadas). São extraídos de "n/m" na descrição **só em lançamentos de conta `credit_card`** (no commit da importação e no lançamento manual). Não há backfill. Ainda não existe parser de fatura do C6 (sem arquivo de exemplo); o bloco de cartões funciona com os lançamentos que existirem nas contas de cartão.
4. **Fatura**: ciclo = compras de `closingDay_anterior+1` até `closingDay` (com dia limitado ao último do mês); vence em `dueDay` do mês do fechamento se `dueDay > closingDay`, senão no mês seguinte. Fatura aberta = despesas − receitas **não pareadas** (estornos) do ciclo; pagamento = receita **pareada** na conta do cartão entre o fechamento e o fechamento seguinte. Cartão sem `closingDay`/`dueDay` aparece como `configured: false`.
5. **Transferência entre entidades (PJ→PF)**: continua fora de receita/despesa (regra da spec), mas o fluxo de caixa devolve `transfersNetCents` por mês (receita pareada − despesa pareada dentro do escopo filtrado) para que a visão PJ ou PF mostre quanto entrou/saiu por transferência interna (pró-labore, aportes).
6. **`vsBudget`**: limite do orçamento `fixed` × quantidade de meses que o período toca (um mês → o limite; trimestre → ×3).
7. **Previsão** (3 meses): receita = média dos 6 meses fechados anteriores; despesa = variável (média de despesas − recorrentes − média de parcelas) + recorrentes detectadas + `ScheduledBill` não casadas com recorrente + parcelas futuras; saldo projetado parte do saldo atual do escopo. Aproximação conhecida: uma conta agendada que não casa por nome com uma recorrente pode contar em dobro com a média histórica.
8. **Teto de IA por job**: no máximo 500 lançamentos por job vão ao LLM (os mais recentes primeiro); o restante vira `pending` (fila manual), nunca fica invisível. O resultado do job ganha `aiFailures` e `deferred`.
9. **Linhas esquecidas**: a fila "Para categorizar" também mostra linhas `none/ok` sem categoria com mais de 15 minutos (job que falhou ou nunca foi enfileirado).
10. **Privacidade do LLM**: CPF, CNPJ e sequências de 6+ dígitos são mascarados antes de ir ao prompt; a chamada ao OpenRouter pede `provider.data_collection = "deny"`.
11. **Ícones**: a navegação usa rótulos de texto (sem emojis nem biblioteca de ícones).

---

## File Structure

Criar:
- `packages/shared/src/dashboard.ts` — filtro Zod, período, comparação, empilhamento, insight (Task 1)
- `packages/shared/src/cards.ts` — ciclo de fatura e parcelas (Task 2)
- `packages/shared/src/recurring.ts` — recorrência, conta agendada, previsão (Task 2)
- `packages/shared/src/redact.ts` — máscara de dados sensíveis para o LLM (Task 4)
- `prisma/migrations/20261001100000_fase13_parcelas/migration.sql` (Task 3)
- `apps/api/src/dashboard/dashboard-filter.ts` — parse do filtro + fragmento SQL de escopo (Task 5)
- `apps/api/src/dashboard/spending.service.ts`, `cards.service.ts`, `cashflow.service.ts`, `summary.service.ts` (Tasks 5–7)
- `apps/api/test/e2e/dashboards.e2e.test.ts` (Tasks 5–7)
- `apps/web/src/router.ts`, `apps/web/src/stores/theme.ts`, `apps/web/src/components/ui/*.vue`, `apps/web/src/components/charts/EChart.vue`, `apps/web/src/lib/dashboard-client.ts`, `apps/web/src/lib/dashboard-charts.ts`, `apps/web/src/lib/money.ts`, `apps/web/src/views/PainelView.vue`, `apps/web/src/views/InicioView.vue`, `apps/web/src/views/AjustesView.vue`, `apps/web/src/views/RegrasView.vue` (Tasks 8–11)

Modificar: `prisma/schema.prisma`, `apps/api/src/balances/*`, `apps/api/src/dashboard/*`, `apps/api/src/transactions/*`, `apps/api/src/import/*`, `apps/api/src/review/*`, `apps/worker/src/ai/*`, `packages/shared/src/index.ts`, `packages/shared/src/ofx.ts`, `apps/web/src/App.vue`, `apps/web/src/main.ts`, `apps/web/src/styles/tokens.css`, todas as views existentes (tokens), `README.md`.

---

### Task 1: Lógica pura de período, filtro e comparação (shared)

**Files:**
- Create: `packages/shared/src/dashboard.ts`
- Modify: `packages/shared/src/index.ts` (adicionar `export * from "./dashboard";`)
- Test: `packages/shared/src/__tests__/dashboard.test.ts`

**Interfaces:**
- Produces (consumido pelas Tasks 5–7 na API e espelhado em `apps/web/src/lib/dashboard-client.ts` na Task 8):
  - `dashboardFilterSchema` / `type DashboardFilter = { entity: "pf"|"pj"|"all"; accountId?: string; month?: string; quarter?: string; year?: string; from?: string; to?: string; asOf?: string }`
  - `type Period = { kind: "month"|"quarter"|"year"|"range"; from: string; to: string; label: string }` (`from`/`to` inclusivos, `YYYY-MM-DD`)
  - `resolvePeriod(f, today): Period`, `previousPeriod(p): Period`, `periodMonths(p): string[]`, `lastMonths(endYm, n): string[]`
  - Helpers de data ISO: `addDaysISO`, `daysBetweenISO`, `lastDayOfMonth(ym)`, `addMonths(ym, n)`, `isoDate(date: Date): string`
  - `stackByMonth(rows, months, topN?)`, `pctChange(cur, prev)`, `biggestMover(rows, minPct?)`

- [ ] **Step 1: Escrever o teste que falha** — `packages/shared/src/__tests__/dashboard.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  dashboardFilterSchema, resolvePeriod, previousPeriod, periodMonths, lastMonths,
  addMonths, addDaysISO, daysBetweenISO, lastDayOfMonth, stackByMonth, pctChange, biggestMover,
} from "../dashboard";

describe("dashboardFilterSchema", () => {
  it("aceita só um tipo de período e entity padrão all", () => {
    expect(dashboardFilterSchema.parse({}).entity).toBe("all");
    expect(dashboardFilterSchema.parse({ month: "2026-06", entity: "pj" })).toMatchObject({ month: "2026-06", entity: "pj" });
  });
  it("rejeita períodos misturados, from sem to, datas falsas e intervalos invertidos ou enormes", () => {
    expect(() => dashboardFilterSchema.parse({ month: "2026-06", year: "2026" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2026-01-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2026-02-30", to: "2026-03-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2026-03-02", to: "2026-03-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ from: "2020-01-01", to: "2026-03-01" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ month: "2026-13" })).toThrow();
    expect(() => dashboardFilterSchema.parse({ entity: "xx" })).toThrow();
  });
});

describe("datas ISO", () => {
  it("addMonths atravessa o ano e lastDayOfMonth respeita bissexto", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(lastDayOfMonth("2024-02")).toBe(29);
    expect(lastDayOfMonth("2026-02")).toBe(28);
    expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetweenISO("2026-03-01", "2026-03-10")).toBe(9);
  });
});

describe("resolvePeriod / previousPeriod", () => {
  it("usa o mês de hoje por padrão", () => {
    expect(resolvePeriod({}, "2026-06-20")).toMatchObject({ kind: "month", from: "2026-06-01", to: "2026-06-30" });
  });
  it("trimestre, ano e intervalo", () => {
    expect(resolvePeriod({ quarter: "2026-Q2" }, "2026-06-20")).toMatchObject({ kind: "quarter", from: "2026-04-01", to: "2026-06-30" });
    expect(resolvePeriod({ year: "2026" }, "2026-06-20")).toMatchObject({ kind: "year", from: "2026-01-01", to: "2026-12-31" });
    expect(resolvePeriod({ from: "2026-03-10", to: "2026-03-19" }, "2026-06-20")).toMatchObject({ kind: "range", from: "2026-03-10", to: "2026-03-19" });
  });
  it("período anterior de mesma duração", () => {
    expect(previousPeriod(resolvePeriod({ month: "2026-01" }, "2026-06-20"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(previousPeriod(resolvePeriod({ quarter: "2026-Q1" }, "2026-06-20"))).toMatchObject({ from: "2025-10-01", to: "2025-12-31" });
    expect(previousPeriod(resolvePeriod({ year: "2026" }, "2026-06-20"))).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
    expect(previousPeriod(resolvePeriod({ from: "2026-03-10", to: "2026-03-19" }, "2026-06-20"))).toMatchObject({ from: "2026-02-28", to: "2026-03-09" });
  });
  it("meses tocados e janela dos últimos n meses", () => {
    expect(periodMonths(resolvePeriod({ quarter: "2026-Q4" }, "2026-06-20"))).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(periodMonths(resolvePeriod({ from: "2026-01-31", to: "2026-02-01" }, "2026-06-20"))).toEqual(["2026-01", "2026-02"]);
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("stackByMonth", () => {
  const rows = [
    { categoryId: "a", name: "Mercado", month: "2026-05", totalCents: 100 },
    { categoryId: "a", name: "Mercado", month: "2026-06", totalCents: 300 },
    { categoryId: "b", name: "Lazer", month: "2026-06", totalCents: 200 },
    { categoryId: "c", name: "Café", month: "2026-06", totalCents: 50 },
    { categoryId: null, name: "Sem categoria", month: "2026-05", totalCents: 10 },
  ];
  it("mantém as top N e agrega o resto em Outras, alinhado aos meses", () => {
    const out = stackByMonth(rows, ["2026-05", "2026-06"], 2);
    expect(out.series.map((s) => s.name)).toEqual(["Mercado", "Lazer", "Outras"]);
    expect(out.series[0].totalsCents).toEqual([100, 300]);
    expect(out.series[1].totalsCents).toEqual([0, 200]);
    expect(out.series[2]).toMatchObject({ key: "__others", totalsCents: [10, 50] });
  });
  it("sem excedente não cria Outras; 'Sem categoria' é uma série normal", () => {
    const out = stackByMonth(rows, ["2026-05", "2026-06"], 6);
    expect(out.series.map((s) => s.name)).toEqual(["Mercado", "Lazer", "Café", "Sem categoria"]);
    expect(out.series.some((s) => s.key === "__others")).toBe(false);
  });
});

describe("pctChange / biggestMover", () => {
  it("pctChange é nulo sem base e arredonda", () => {
    expect(pctChange(118, 100)).toBe(18);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(10, 0)).toBeNull();
  });
  it("biggestMover escolhe a maior variação absoluta em centavos acima do mínimo", () => {
    const rows = [
      { name: "Supermercado", currentCents: 11800, previousCents: 10000 },
      { name: "Lazer", currentCents: 5000, previousCents: 4900 },
      { name: "Transporte", currentCents: 1000, previousCents: 3000 },
      { name: "Novo", currentCents: 9000, previousCents: 0 },
    ];
    expect(biggestMover(rows)).toBe("Transporte caiu 67% vs. período anterior");
    expect(biggestMover([rows[1]])).toBeNull();
    expect(biggestMover([])).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @app/shared test -- dashboard` → falha ("Cannot find module ../dashboard").

- [ ] **Step 3: Implementar** — `packages/shared/src/dashboard.ts`

```ts
import { z } from "zod";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => YMD.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
export function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
export function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
export function lastDayOfMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export const dashboardFilterSchema = z
  .object({
    entity: z.enum(["pf", "pj", "all"]).default("all"),
    accountId: z.string().min(1).optional(),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
    year: z.string().regex(/^\d{4}$/).optional(),
    from: z.string().refine(isRealDate, "data inválida").optional(),
    to: z.string().refine(isRealDate, "data inválida").optional(),
    asOf: z.string().refine(isRealDate, "data inválida").optional(),
  })
  .superRefine((v, ctx) => {
    const kinds = [v.month, v.quarter, v.year, v.from || v.to].filter(Boolean).length;
    if (kinds > 1) ctx.addIssue({ code: "custom", message: "informe um único tipo de período" });
    if (Boolean(v.from) !== Boolean(v.to)) ctx.addIssue({ code: "custom", message: "from e to devem vir juntos" });
    if (v.from && v.to) {
      if (v.from > v.to) ctx.addIssue({ code: "custom", message: "from deve ser anterior a to" });
      else if (daysBetweenISO(v.from, v.to) > 1100) ctx.addIssue({ code: "custom", message: "intervalo máximo de 1100 dias" });
    }
  });

export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;

export type Period = { kind: "month" | "quarter" | "year" | "range"; from: string; to: string; label: string };

function monthSpan(startYm: string, count: number): { from: string; to: string } {
  const endYm = addMonths(startYm, count - 1);
  return { from: `${startYm}-01`, to: `${endYm}-${pad(lastDayOfMonth(endYm))}` };
}

export function resolvePeriod(f: Pick<DashboardFilter, "month" | "quarter" | "year" | "from" | "to">, today: string): Period {
  if (f.from && f.to) return { kind: "range", from: f.from, to: f.to, label: `${f.from} a ${f.to}` };
  if (f.year) return { kind: "year", ...monthSpan(`${f.year}-01`, 12), label: f.year };
  if (f.quarter) {
    const [y, q] = f.quarter.split("-Q").map(Number);
    return { kind: "quarter", ...monthSpan(`${y}-${pad((q - 1) * 3 + 1)}`, 3), label: `${q}º tri ${y}` };
  }
  const ym = f.month ?? today.slice(0, 7);
  const [y, m] = ym.split("-");
  return { kind: "month", ...monthSpan(ym, 1), label: `${m}/${y}` };
}

export function previousPeriod(p: Period): Period {
  if (p.kind === "range") {
    const n = daysBetweenISO(p.from, p.to) + 1;
    const to = addDaysISO(p.from, -1);
    const from = addDaysISO(to, -(n - 1));
    return { kind: "range", from, to, label: `${from} a ${to}` };
  }
  const len = p.kind === "month" ? 1 : p.kind === "quarter" ? 3 : 12;
  const start = addMonths(p.from.slice(0, 7), -len);
  return resolvePeriod(
    p.kind === "month" ? { month: start } : p.kind === "year" ? { year: start.slice(0, 4) } : { quarter: `${start.slice(0, 4)}-Q${Math.floor((Number(start.slice(5)) - 1) / 3) + 1}` },
    p.to,
  );
}

export function periodMonths(p: Period): string[] {
  const out: string[] = [];
  for (let ym = p.from.slice(0, 7); ym <= p.to.slice(0, 7); ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

export function lastMonths(endYm: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(endYm, i - (n - 1)));
}

export type CategoryMonthTotal = { categoryId: string | null; name: string; month: string; totalCents: number };
export type StackedSeries = { key: string; categoryId: string | null; name: string; totalsCents: number[] };

export function stackByMonth(rows: CategoryMonthTotal[], months: string[], topN = 6): { months: string[]; series: StackedSeries[] } {
  const byCat = new Map<string, { categoryId: string | null; name: string; byMonth: Map<string, number>; total: number }>();
  for (const r of rows) {
    const key = r.categoryId ?? "__none";
    const cur = byCat.get(key) ?? { categoryId: r.categoryId, name: r.name, byMonth: new Map(), total: 0 };
    cur.byMonth.set(r.month, (cur.byMonth.get(r.month) ?? 0) + r.totalCents);
    cur.total += r.totalCents;
    byCat.set(key, cur);
  }
  const ranked = [...byCat.entries()].sort((a, b) => b[1].total - a[1].total || a[1].name.localeCompare(b[1].name));
  const series: StackedSeries[] = ranked.slice(0, topN).map(([key, c]) => ({
    key, categoryId: c.categoryId, name: c.name, totalsCents: months.map((m) => c.byMonth.get(m) ?? 0),
  }));
  const rest = ranked.slice(topN);
  if (rest.length) {
    series.push({
      key: "__others", categoryId: null, name: "Outras",
      totalsCents: months.map((m) => rest.reduce((s, [, c]) => s + (c.byMonth.get(m) ?? 0), 0)),
    });
  }
  return { months, series };
}

export function pctChange(currentCents: number, previousCents: number): number | null {
  return previousCents > 0 ? Math.round((currentCents / previousCents - 1) * 100) : null;
}

export function biggestMover(
  rows: Array<{ name: string; currentCents: number; previousCents: number }>,
  minPct = 10,
): string | null {
  let best: { name: string; pct: number; delta: number } | null = null;
  for (const r of rows) {
    const pct = pctChange(r.currentCents, r.previousCents);
    if (pct === null || Math.abs(pct) < minPct) continue;
    const delta = Math.abs(r.currentCents - r.previousCents);
    if (!best || delta > best.delta) best = { name: r.name, pct, delta };
  }
  return best ? `${best.name} ${best.pct > 0 ? "subiu" : "caiu"} ${Math.abs(best.pct)}% vs. período anterior` : null;
}
```

- [ ] **Step 4: Exportar e rodar** — adicionar `export * from "./dashboard";` em `packages/shared/src/index.ts`; `pnpm --filter @app/shared test` → todos passam; `pnpm --filter @app/shared typecheck`.

- [ ] **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): filtro, período e comparação do dashboard"`

---

### Task 2: Recorrência, ciclo de fatura, parcelas e previsão (shared)

**Files:**
- Create: `packages/shared/src/recurring.ts`, `packages/shared/src/cards.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/recurring.test.ts`, `packages/shared/src/__tests__/cards.test.ts`

**Interfaces:**
- Consumes: `normalizeDescriptionKey` (`./categorization`), `addMonths`, `addDaysISO`, `lastDayOfMonth` (`./dashboard`).
- Produces:
  - `detectRecurring(rows: RecurringInput[]): RecurringGroup[]` com `RecurringInput = { description: string; amountCents: number; date: string; installment?: boolean }` e `RecurringGroup = { key; label; frequency: "monthly"|"weekly"; avgCents; intervalDays; occurrences; monthlyEstimateCents; lastDate }`
  - `billAmountInMonth(bill, ym): number`, `forecastCashflow(input): ForecastMonth[]` (tipos abaixo)
  - `InvoiceCycle = { ym; start; closing; due }`, `cycleClosingIn(ym, closingDay, dueDay)`, `cycleOf(date, closingDay, dueDay)`, `recentCycles(today, closingDay, dueDay, closedCount)` → `{ open, closed }` (closed em ordem cronológica)
  - `parseInstallment(text): { current: number; total: number } | null`

- [ ] **Step 1: Escrever os testes que falham**

`packages/shared/src/__tests__/cards.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { cycleClosingIn, cycleOf, recentCycles, parseInstallment } from "../cards";

describe("ciclo de fatura", () => {
  it("fecha dia 10, vence dia 17 do mesmo mês", () => {
    expect(cycleClosingIn("2026-06", 10, 17)).toEqual({ ym: "2026-06", start: "2026-05-11", closing: "2026-06-10", due: "2026-06-17" });
  });
  it("vencimento antes do fechamento cai no mês seguinte", () => {
    expect(cycleClosingIn("2026-06", 25, 5)).toEqual({ ym: "2026-06", start: "2026-05-26", closing: "2026-06-25", due: "2026-07-05" });
  });
  it("dia 31 é limitado ao último dia do mês", () => {
    expect(cycleClosingIn("2026-02", 31, 10)).toMatchObject({ start: "2026-02-01", closing: "2026-02-28" });
    expect(cycleClosingIn("2026-03", 31, 10)).toMatchObject({ start: "2026-03-01", closing: "2026-03-31" });
  });
  it("compra no dia do fechamento fica na fatura que fecha; no dia seguinte vai para a próxima", () => {
    expect(cycleOf("2026-06-10", 10, 17).ym).toBe("2026-06");
    expect(cycleOf("2026-06-11", 10, 17)).toMatchObject({ ym: "2026-07", start: "2026-06-11", closing: "2026-07-10" });
  });
  it("virada de ano", () => {
    expect(cycleOf("2026-12-20", 10, 17)).toMatchObject({ ym: "2027-01", closing: "2027-01-10" });
  });
  it("recentCycles devolve a aberta e as fechadas em ordem cronológica", () => {
    const r = recentCycles("2026-06-20", 10, 17, 3);
    expect(r.open.ym).toBe("2026-07");
    expect(r.closed.map((c) => c.ym)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
});

describe("parseInstallment", () => {
  it("lê n/m na descrição", () => {
    expect(parseInstallment("LOJA X 03/10")).toEqual({ current: 3, total: 10 });
    expect(parseInstallment("Parcela 2/12 Amazon")).toEqual({ current: 2, total: 12 });
  });
  it("ignora datas, mês/ano, total 1 e parcela maior que o total", () => {
    expect(parseInstallment("PAGAMENTO 12/03/2026")).toBeNull();
    expect(parseInstallment("Netflix 01/2026")).toBeNull();
    expect(parseInstallment("COMPRA 5/1")).toBeNull();
    expect(parseInstallment("AMAZON 13/12")).toBeNull();
    expect(parseInstallment("")).toBeNull();
  });
});
```

`packages/shared/src/__tests__/recurring.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectRecurring, billAmountInMonth, forecastCashflow } from "../recurring";

const monthly = (desc: string, amounts: number[], start = "2026-01-10") =>
  amounts.map((amountCents, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return { description: desc, amountCents, date: d.toISOString().slice(0, 10) };
  });

describe("detectRecurring", () => {
  it("assinatura mensal com dígitos variando na descrição", () => {
    const rows = [
      { description: "NETFLIX 01/2026", amountCents: 5590, date: "2026-01-10" },
      { description: "NETFLIX 02/2026", amountCents: 5590, date: "2026-02-10" },
      { description: "NETFLIX 03/2026", amountCents: 5590, date: "2026-03-10" },
      { description: "NETFLIX 04/2026", amountCents: 5590, date: "2026-04-10" },
    ];
    const [g] = detectRecurring(rows);
    expect(g).toMatchObject({ key: "netflix", frequency: "monthly", avgCents: 5590, occurrences: 4, monthlyEstimateCents: 5590, lastDate: "2026-04-10" });
    expect(g.intervalDays).toBe(30);
  });
  it("rejeita menos de 3 ocorrências, desvio de valor acima de 15% e intervalos irregulares", () => {
    expect(detectRecurring(monthly("Spotify", [1990, 1990]))).toEqual([]);
    expect(detectRecurring(monthly("Luz", [10000, 10000, 12000]))).toEqual([]); // 12000 desvia > 15% da média
    expect(detectRecurring([
      { description: "Padaria", amountCents: 1000, date: "2026-01-02" },
      { description: "Padaria", amountCents: 1000, date: "2026-01-03" },
      { description: "Padaria", amountCents: 1000, date: "2026-02-20" },
    ])).toEqual([]);
  });
  it("semanal estima o total mensal e parcelas ficam de fora", () => {
    const weekly = ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23"].map((date) => ({ description: "Feira", amountCents: 3000, date }));
    expect(detectRecurring(weekly)[0]).toMatchObject({ frequency: "weekly", monthlyEstimateCents: Math.round((3000 * 52) / 12) });
    expect(detectRecurring(monthly("Geladeira 03/10", [20000, 20000, 20000]).map((r) => ({ ...r, installment: true })))).toEqual([]);
  });
  it("ordena pelo maior total mensal estimado", () => {
    const out = detectRecurring([...monthly("Spotify", [1990, 1990, 1990]), ...monthly("Aluguel", [200000, 200000, 200000])]);
    expect(out.map((g) => g.key)).toEqual(["aluguel", "spotify"]);
  });
});

describe("billAmountInMonth", () => {
  const base = { amountCents: 1000, dueDate: "2026-03-05", active: true };
  it("única, mensal, anual e semanal", () => {
    expect(billAmountInMonth({ ...base, recurrence: "once" }, "2026-03")).toBe(1000);
    expect(billAmountInMonth({ ...base, recurrence: "once" }, "2026-04")).toBe(0);
    expect(billAmountInMonth({ ...base, recurrence: "monthly" }, "2026-02")).toBe(0);
    expect(billAmountInMonth({ ...base, recurrence: "monthly" }, "2026-07")).toBe(1000);
    expect(billAmountInMonth({ ...base, recurrence: "yearly" }, "2027-03")).toBe(1000);
    expect(billAmountInMonth({ ...base, recurrence: "yearly" }, "2027-04")).toBe(0);
    // 2026-03-05 é quinta: quintas de abril/2026 = 2, 9, 16, 23, 30
    expect(billAmountInMonth({ ...base, recurrence: "weekly" }, "2026-04")).toBe(5000);
    expect(billAmountInMonth({ ...base, active: false, recurrence: "monthly" }, "2026-07")).toBe(0);
  });
});

describe("forecastCashflow", () => {
  const history = ["2026-03", "2026-04", "2026-05"].map((month) => ({ month, incomeCents: 1_000_000, expenseCents: 600_000 }));
  const recurring = [{ key: "netflix", label: "Netflix", frequency: "monthly" as const, avgCents: 100_000, intervalDays: 30, occurrences: 6, monthlyEstimateCents: 100_000, lastDate: "2026-05-10" }];
  it("soma variável, recorrentes, contas e parcelas e acumula o saldo", () => {
    const out = forecastCashflow({
      firstMonth: "2026-07", months: 2, history, historyInstallmentsAvgCents: 50_000, recurring,
      bills: [{ name: "Aluguel", amountCents: 200_000, dueDate: "2026-07-05", recurrence: "monthly", active: true }],
      installments: [{ month: "2026-07", amountCents: 80_000 }],
      startBalanceCents: 100_000,
    });
    expect(out[0]).toEqual({
      month: "2026-07", incomeCents: 1_000_000, variableCents: 450_000, recurringCents: 100_000,
      billsCents: 200_000, installmentsCents: 80_000, expenseCents: 830_000, balanceCents: 270_000,
    });
    expect(out[1]).toMatchObject({ month: "2026-08", installmentsCents: 0, expenseCents: 750_000, balanceCents: 520_000 });
  });
  it("conta que casa com uma recorrente detectada não entra em dobro; sem histórico tudo é zero", () => {
    const out = forecastCashflow({
      firstMonth: "2026-07", months: 1, history, historyInstallmentsAvgCents: 0, recurring,
      bills: [{ name: "Netflix", amountCents: 5590, dueDate: "2026-07-10", recurrence: "monthly", active: true }],
      installments: [], startBalanceCents: 0,
    });
    expect(out[0].billsCents).toBe(0);
    const empty = forecastCashflow({ firstMonth: "2026-07", months: 1, history: [], historyInstallmentsAvgCents: 0, recurring: [], bills: [], installments: [], startBalanceCents: 5 });
    expect(empty[0]).toMatchObject({ incomeCents: 0, expenseCents: 0, balanceCents: 5 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @app/shared test -- cards recurring`.

- [ ] **Step 3: Implementar**

`packages/shared/src/cards.ts`:
```ts
import { addDaysISO, addMonths, lastDayOfMonth } from "./dashboard";

export type InvoiceCycle = { ym: string; start: string; closing: string; due: string };

const pad = (n: number) => String(n).padStart(2, "0");
const clampDay = (ym: string, day: number) => `${ym}-${pad(Math.min(day, lastDayOfMonth(ym)))}`;

/** Ciclo que FECHA no mês `ym`. */
export function cycleClosingIn(ym: string, closingDay: number, dueDay: number): InvoiceCycle {
  const closing = clampDay(ym, closingDay);
  const start = addDaysISO(clampDay(addMonths(ym, -1), closingDay), 1);
  const dueYm = dueDay > closingDay ? ym : addMonths(ym, 1);
  return { ym, start, closing, due: clampDay(dueYm, dueDay) };
}

/** Ciclo (fatura) em que uma compra feita em `date` cai. */
export function cycleOf(date: string, closingDay: number, dueDay: number): InvoiceCycle {
  const ym = date.slice(0, 7);
  const same = cycleClosingIn(ym, closingDay, dueDay);
  return date <= same.closing ? same : cycleClosingIn(addMonths(ym, 1), closingDay, dueDay);
}

export function recentCycles(today: string, closingDay: number, dueDay: number, closedCount: number) {
  const open = cycleOf(today, closingDay, dueDay);
  const closed = Array.from({ length: closedCount }, (_, i) => cycleClosingIn(addMonths(open.ym, i - closedCount), closingDay, dueDay));
  return { open, closed };
}

const INSTALLMENT = /(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d/])/;

/** "n/m" na descrição de lançamento de cartão; ignora datas, mês/ano e valores incoerentes. */
export function parseInstallment(text: string | null | undefined): { current: number; total: number } | null {
  const m = INSTALLMENT.exec(text ?? "");
  if (!m) return null;
  const current = Number(m[1]);
  const total = Number(m[2]);
  return total >= 2 && total <= 60 && current >= 1 && current <= total ? { current, total } : null;
}
```

`packages/shared/src/recurring.ts`:
```ts
import { normalizeDescriptionKey } from "./categorization";
import { addMonths, lastDayOfMonth, daysBetweenISO } from "./dashboard";

export type RecurringInput = { description: string; amountCents: number; date: string; installment?: boolean };
export type RecurringGroup = {
  key: string; label: string; frequency: "monthly" | "weekly"; avgCents: number; intervalDays: number;
  occurrences: number; monthlyEstimateCents: number; lastDate: string;
};

export function detectRecurring(rows: RecurringInput[]): RecurringGroup[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const r of rows) {
    if (r.installment) continue;
    const key = normalizeDescriptionKey(r.description);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  const out: RecurringGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted.slice(1).map((r, i) => daysBetweenISO(sorted[i].date, r.date));
    const intervalDays = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const avg = sorted.reduce((s, r) => s + r.amountCents, 0) / sorted.length;
    if (avg <= 0 || sorted.some((r) => Math.abs(r.amountCents - avg) / avg > 0.15)) continue;
    const frequency = intervalDays >= 25 && intervalDays <= 35 ? "monthly" : intervalDays >= 6 && intervalDays <= 8 ? "weekly" : null;
    if (!frequency) continue;
    const counts = new Map<string, number>();
    for (const r of sorted) counts.set(r.description, (counts.get(r.description) ?? 0) + 1);
    const label = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out.push({
      key, label, frequency, avgCents: Math.round(avg), intervalDays: Math.round(intervalDays), occurrences: sorted.length,
      monthlyEstimateCents: frequency === "monthly" ? Math.round(avg) : Math.round((avg * 52) / 12),
      lastDate: sorted[sorted.length - 1].date,
    });
  }
  return out.sort((a, b) => b.monthlyEstimateCents - a.monthlyEstimateCents || a.key.localeCompare(b.key));
}

export type Bill = { name: string; amountCents: number; dueDate: string; recurrence: "once" | "weekly" | "monthly" | "yearly"; active: boolean };

export function billAmountInMonth(bill: Omit<Bill, "name"> & { name?: string }, ym: string): number {
  if (!bill.active) return 0;
  const startYm = bill.dueDate.slice(0, 7);
  if (ym < startYm) return 0;
  switch (bill.recurrence) {
    case "once": return ym === startYm ? bill.amountCents : 0;
    case "monthly": return bill.amountCents;
    case "yearly": return ym.slice(5) === startYm.slice(5) ? bill.amountCents : 0;
    case "weekly": {
      const weekday = new Date(`${bill.dueDate}T00:00:00Z`).getUTCDay();
      let n = 0;
      for (let d = 1; d <= lastDayOfMonth(ym); d++) {
        const iso = `${ym}-${String(d).padStart(2, "0")}`;
        if (iso >= bill.dueDate && new Date(`${iso}T00:00:00Z`).getUTCDay() === weekday) n++;
      }
      return n * bill.amountCents;
    }
  }
}

export type ForecastInput = {
  firstMonth: string;
  months: number;
  history: Array<{ month: string; incomeCents: number; expenseCents: number }>;
  historyInstallmentsAvgCents: number;
  recurring: RecurringGroup[];
  bills: Bill[];
  installments: Array<{ month: string; amountCents: number }>;
  startBalanceCents: number;
};
export type ForecastMonth = {
  month: string; incomeCents: number; variableCents: number; recurringCents: number;
  billsCents: number; installmentsCents: number; expenseCents: number; balanceCents: number;
};

export function forecastCashflow(input: ForecastInput): ForecastMonth[] {
  const n = input.history.length;
  const incomeCents = n ? Math.round(input.history.reduce((s, h) => s + h.incomeCents, 0) / n) : 0;
  const avgExpense = n ? input.history.reduce((s, h) => s + h.expenseCents, 0) / n : 0;
  const recurringCents = input.recurring.reduce((s, g) => s + g.monthlyEstimateCents, 0);
  const variableCents = Math.max(0, Math.round(avgExpense) - recurringCents - input.historyInstallmentsAvgCents);
  const covered = (name: string) => {
    const k = normalizeDescriptionKey(name);
    return !!k && input.recurring.some((g) => g.key.includes(k) || k.includes(g.key));
  };
  const bills = input.bills.filter((b) => !covered(b.name));

  let balance = input.startBalanceCents;
  return Array.from({ length: input.months }, (_, i) => {
    const month = addMonths(input.firstMonth, i);
    const billsCents = bills.reduce((s, b) => s + billAmountInMonth(b, month), 0);
    const installmentsCents = input.installments.filter((x) => x.month === month).reduce((s, x) => s + x.amountCents, 0);
    const expenseCents = variableCents + recurringCents + billsCents + installmentsCents;
    balance += incomeCents - expenseCents;
    return { month, incomeCents, variableCents, recurringCents, billsCents, installmentsCents, expenseCents, balanceCents: balance };
  });
}
```

- [ ] **Step 4: Exportar e rodar** — adicionar `export * from "./cards"; export * from "./recurring";` em `packages/shared/src/index.ts`; `pnpm --filter @app/shared test && pnpm --filter @app/shared typecheck` → verde.

- [ ] **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): recorrência, ciclo de fatura, parcelas e previsão de caixa"`

---

### Task 3: Colunas de parcela e extração no commit e no lançamento manual

**Files:**
- Modify: `prisma/schema.prisma` (Transaction: `installmentCurrent Int?`, `installmentTotal Int?`)
- Create: `prisma/migrations/20261001100000_fase13_parcelas/migration.sql`
- Modify: `apps/api/src/import/import.service.ts` (commit), `apps/api/src/transactions/transactions.service.ts` (`create`), `apps/api/src/transactions/transactions.service.ts` (`list` passa a devolver os campos novos junto de `transferPairId`, `ignored`, `categorySource`, `reviewStatus`, `installmentCurrent`, `installmentTotal`)
- Test: `apps/api/test/e2e/dashboards.e2e.test.ts` (criar o arquivo com o bloco "parcelas"); `apps/api/test/database/schema.test.ts` se ele enumera colunas

**Interfaces:**
- Consumes: `parseInstallment` (Task 2).
- Produces: `Transaction.installmentCurrent/installmentTotal` preenchidos apenas quando a conta é `credit_card`; `GET /transactions` com os campos extras acima (usados na Task 11).

- [ ] **Step 1:** Antes de editar o schema, copie-o: `cp prisma/schema.prisma /tmp/schema-antes.prisma` (use o diretório scratchpad da sessão). Adicione os dois campos `Int?` em `Transaction` (logo após `ignored`).
- [ ] **Step 2:** Gerar a migration: `pnpm prisma migrate diff --from-schema <schema-antes> --to-schema prisma/schema.prisma --script > prisma/migrations/20261001100000_fase13_parcelas/migration.sql` (criar a pasta). O conteúdo esperado são dois `ALTER TABLE "transactions" ADD COLUMN ...`. Aplicar: `pnpm prisma migrate deploy`; conferir drift: `pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` deve imprimir "empty migration". Rodar `pnpm prisma generate` (api e worker têm client gerado próprio — veja os scripts `generate` do `package.json`).
- [ ] **Step 3: Escrever o teste que falha** (e2e, usa o mesmo cabeçalho de setup de `agregacao.e2e.test.ts`: `Test.createTestingModule`, `auth.api.signUpEmail`, `cleanDb`):
  - lançamento manual `POST /transactions` em conta `credit_card` com descrição `"LOJA X 03/10"` → `installmentCurrent 3`, `installmentTotal 10`; na mesma conta com `"Netflix 01/2026"` → ambos `null`; em conta `checking` com `"LOJA X 03/10"` → `null`.
  - `GET /transactions` devolve `transferPairId`, `ignored`, `categorySource`, `reviewStatus`, `installmentCurrent`, `installmentTotal` por linha.
  - importação: `POST /import/preview` + `/import/:batchId/commit` de um OFX com uma linha `MEMO LOJA X 02/05` em conta `credit_card` grava `installmentCurrent 2`/`installmentTotal 5` (veja `integridade-importacao.e2e.test.ts` para montar o OFX e o fluxo).
- [ ] **Step 4: Implementar.** Em `TransactionsService.create`: buscar o `type` da conta (`dto.accountId`) — a consulta de validação das contas já existe, ampliar o `select` para `{ id, type }`; se `dto.type === "expense"` e a conta é `credit_card`, `const inst = parseInstallment(dto.description ?? dto.counterparty)` e gravar `installmentCurrent: inst?.current ?? null`, `installmentTotal: inst?.total ?? null`; incluir os campos no `select` de retorno. No commit da importação: carregar o `type` da conta do lote uma vez e, para cada linha `expense` quando for `credit_card`, aplicar o mesmo cálculo ao montar o `payload` do `createMany`. Em `list`, acrescentar os campos ao `select`.
- [ ] **Step 5: Rodar** — `pnpm --filter @app/api test -- dashboards finance import integridade` (e2e de importação e finanças continuam verdes), `pnpm typecheck`.
- [ ] **Step 6: Commit** — `git add prisma apps/api && git commit -m "feat: parcelas (n/m) em lançamentos de cartão e campos de revisão na lista de transações"`

---

### Task 4: Endurecimento da categorização (teto de IA, privacidade, linhas esquecidas)

**Files:**
- Create: `packages/shared/src/redact.ts`; Test: `packages/shared/src/__tests__/redact.test.ts`
- Modify: `packages/shared/src/index.ts`, `apps/worker/src/ai/categorize.core.ts`, `apps/worker/src/ai/categorize.processor.ts`, `apps/worker/src/ai/openrouter.ts`, `packages/shared/src/ofx.ts`, `apps/api/src/review/review.service.ts` (`pending`)
- Test: `apps/worker/src/__tests__/categorize-*.test.ts` (estender), `packages/shared/src/__tests__/ofx.test.ts` (estender), `apps/api/test/e2e/revisao.e2e.test.ts` (estender)

**Interfaces:**
- Produces: `redactForLlm(text: string): string`; resultado do job `AiJob.result` ganha `aiFailures: number` e `deferred: number`; constante `MAX_AI_ROWS_PER_JOB = 500` exportada do core.

- [ ] **Step 1: Testes que falham**
  - `redact.test.ts`: `redactForLlm("PIX JOAO 123.456.789-00")` → `"PIX JOAO ###"`; CNPJ `12.345.678/0001-95` → `###`; sequência `"BOLETO 1234567890123"` → `"BOLETO ###"`; texto com até 5 dígitos seguidos (`"LOJA 12345"`, `"03/10"`) fica intacto; vazio/`null`-like retorna `""`.
  - `ofx.test.ts`: valor `"1.234,56"` e `"-1.234,56"` viram 123456 / −123456 centavos; `"1234,56"` e `"1234.56"` continuam corretos (hoje só a primeira vírgula é trocada: corrigir `parseOfx`).
  - worker (core): com `MAX_AI_ROWS_PER_JOB + 3` linhas sem regra, só as 500 mais recentes (por `date` desc) vão ao gateway; as 3 restantes saem no plano como pendentes (`reviewStatus pending`, sem sugestão) e o resumo traz `deferred: 3`; uma falha do gateway num lote soma `aiFailures: 1` e as linhas do lote ficam pendentes; o texto que chega ao gateway passou por `redactForLlm`.
  - worker (openrouter): o corpo enviado inclui `provider: { data_collection: "deny" }` (teste com `fetch` mockado, como os existentes).
  - e2e (`revisao`): linha `categorySource none`, `reviewStatus ok`, sem categoria, `createdAt` há 30 min (criar direto via prisma com `createdAt` explícito) aparece em `GET /review/pending`; a mesma criada agora não aparece; linha de par ou ignorada nunca aparece.
- [ ] **Step 2: Implementar.**
  - `redact.ts`: regexes de CNPJ `\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b`, CPF `\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b`, depois `\d{6,}`; todas substituem por `###`. Aplicar em `categorize.core.ts` ao montar cada item do prompt (descrição e contraparte); o texto original continua sendo usado nas regras.
  - `categorize.core.ts`: após a etapa de regras, ordenar o restante por `date` desc, enviar os `MAX_AI_ROWS_PER_JOB` primeiros em lotes de `aiBatchSize`; o resto → pendente. Capturar falha por lote (`try/catch` já existe — passar a contar). O retorno de `planCategorization` e o `result` do processor incluem `aiFailures` e `deferred`.
  - `openrouter.ts`: acrescentar `provider: { data_collection: "deny" }` ao corpo de cada chamada.
  - `parseOfx`: normalizar com `s.replace(/\./g, "").replace(",", ".")` apenas quando houver vírgula (formato BR); caso contrário manter o ponto como decimal.
  - `ReviewService.pending`: o `where` passa a ser `OR [{ reviewStatus: "pending" }, { reviewStatus: "ok", categorySource: "none", categoryId: null, createdAt: { lt: new Date(Date.now() - 15 * 60_000) } }]`, sempre com `transferPairId: null, ignored: false`.
- [ ] **Step 3: Rodar** — `pnpm --filter @app/shared test && pnpm --filter @app/worker test` e, **sozinho**, o e2e `pnpm --filter @app/api test -- revisao`; `pnpm typecheck --force`.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: teto de IA por job, máscara de dados sensíveis, OFX com milhar e linhas esquecidas na fila"`

---

### Task 5: Filtro do dashboard, saldos em SQL e `GET /dashboard/spending`

**Files:**
- Create: `apps/api/src/dashboard/dashboard-filter.ts`, `apps/api/src/dashboard/spending.service.ts`
- Modify: `apps/api/src/dashboard/dashboard.controller.ts`, `apps/api/src/dashboard/dashboard.module.ts`, `apps/api/src/balances/balances.service.ts`, `apps/api/src/balances/balances.controller.ts`, `apps/api/src/chat/tools.ts` (só se `get_balance` calcula por conta própria; reutilizar `BalancesService`)
- Test: `apps/api/test/e2e/dashboards.e2e.test.ts` (blocos "spending" e "balances")

**Interfaces:**
- Consumes: `dashboardFilterSchema`, `resolvePeriod`, `previousPeriod`, `periodMonths`, `lastMonths`, `stackByMonth`, `biggestMover`, `pctChange`, `detectRecurring` (shared), `reportableSql` (api common).
- Produces:
  - `parseDashboardFilter(query, today?)` → `{ entity?: AccountEntity; accountId?: string; period: Period; asOf: string }` (ZodError vira 400 pelo filtro global; valores `""` são ignorados)
  - `scopeSql(scope)` → `Prisma.Sql` com `AND t."accountId" = ...` e `AND a."entity"::text = ...` (a consulta precisa de `LEFT JOIN bank_accounts a ON a."id" = t."accountId"`)
  - `assertScopeAccount(workspaceId, accountId?)` → 400 `"conta inexistente no workspace"` se a conta não é do workspace
  - `BalancesService.accountBalances(workspaceId, scope: { entity?, accountId? }, asOf?: string)` → `Array<{ accountId, name, type, entity, balanceCents }>` (SQL; `asOf` limita a movimentos com `date <= asOf`); `getForWorkspace` passa a usá-lo e mantém o contrato atual `{ accounts: [{accountId,name,type,balanceCents}], consolidatedCents }`
  - `GET /dashboard/spending` devolve:
    `{ period: Period, previousPeriod: Period, totalCents, previousTotalCents, insight: string|null, byCategory: [{categoryId,name,totalCents,previousCents,pct,count}], byMonth: { months: string[], series: StackedSeries[] }, vsBudget: [{categoryId,name,limitCents,spentCents,pct}], topCounterparties: [{name,totalCents,count}], recurring: RecurringGroup[] }`

- [ ] **Step 1: Testes que falham** — em `dashboards.e2e.test.ts` (mesmo setup de `agregacao.e2e.test.ts`; cada teste cria o próprio workspace). Seed de "spending": contas `PF1` (checking, pf) e `PJ1` (checking, pj); categorias `Mercado` (expense, both), `Software` (expense, pj); orçamento `fixed` de `Mercado` com limite 20000. Lançamentos (todos `expense`): junho/2026 — PF1 Mercado 10000 e 5000; PJ1 Software 30000 com `counterparty "Software SA"`; PF1 Mercado 99999 com `transferPairId "p"` (fora); PF1 Mercado 8000 `ignored` (fora). Maio/2026 — PF1 Mercado 6000; PJ1 Software 30000.
  - `GET /dashboard/spending?month=2026-06&asOf=2026-06-20` (entity ausente): `totalCents 45000`, `previousTotalCents 36000`, `byCategory` = Software 30000 (`pct 67`, `count 1`, `previousCents 30000`) depois Mercado 15000 (`pct 33`, `count 2`, `previousCents 6000`), `insight "Mercado subiu 150% vs. período anterior"`, `vsBudget` = `[ { name:"Mercado", limitCents:20000, spentCents:15000, pct:75 } ]`, `topCounterparties[0]` = `{ name:"Software SA", totalCents:30000, count:1 }`, `byMonth.months` com 12 meses terminando em `2026-06` e série `Software` terminando em `[…, 30000, 30000]`, série `Mercado` terminando em `[…, 6000, 15000]`.
  - `entity=pf`: `byCategory` só `Mercado 15000`, `totalCents 15000`; `entity=pj`: só `Software`; `accountId=<PF1>`: igual a `pf`; `accountId` de outro workspace → 400.
  - `quarter=2026-Q2` (abril 0, maio 36000, junho 45000): `totalCents 81000`, `previousTotalCents 0` (primeiro trimestre sem lançamentos), `insight null`, `vsBudget[0]` = `{ limitCents: 60000, spentCents: 21000, pct: 35 }`.
  - recorrência: workspace separado com três despesas `"NETFLIX 04/2026"`, `"NETFLIX 05/2026"`, `"NETFLIX 06/2026"` de 5590 em 10/04, 10/05 e 10/06 → `recurring[0]` com `key "netflix"`, `frequency "monthly"`, `monthlyEstimateCents 5590`; uma despesa com `installmentTotal 10` não entra.
  - filtros inválidos → 400 (`month=2026-13`, `month=2026-06&year=2026`).
  - "balances": `GET /balances` mantém o contrato; com `entity` PF/PJ e saldos iniciais (PF1 100000, PJ1 50000) mais movimentos (receita PF1 200000, despesa PF1 50000, par: despesa PF1 30000 + receita PJ1 30000, transferência PF1→PJ1 de 400 via `sourceAccountId/destAccountId`) o resultado por conta inclui pares e ignorados (PF1 = 100000 + 200000 − 50000 − 30000 − 400 = 219600; PJ1 = 50000 + 30000 + 400 = 80400) e `consolidatedCents` é a soma.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @app/api test -- dashboards` (rotas inexistentes → 404).
- [ ] **Step 3: Implementar `dashboard-filter.ts`:**

```ts
import { BadRequestException } from "@nestjs/common";
import { dashboardFilterSchema, isoDate, resolvePeriod, type AccountEntity } from "@app/shared";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database";

export type Scope = { entity?: AccountEntity; accountId?: string };

export function parseDashboardFilter(query: Record<string, string | undefined>, today = isoDate(new Date())) {
  const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ""));
  const f = dashboardFilterSchema.parse(clean);
  const asOf = f.asOf ?? today;
  return {
    entity: f.entity === "all" ? undefined : (f.entity as AccountEntity),
    accountId: f.accountId,
    asOf,
    period: resolvePeriod(f, asOf),
  };
}

export function scopeSql(scope: Scope) {
  return Prisma.sql`${scope.accountId ? Prisma.sql`AND t."accountId" = ${scope.accountId}` : Prisma.empty}
    ${scope.entity ? Prisma.sql`AND a."entity"::text = ${scope.entity}` : Prisma.empty}`;
}

export async function assertScopeAccount(workspaceId: string, accountId?: string) {
  if (!accountId) return;
  const acc = await prisma.bankAccount.findFirst({ where: { id: accountId, workspaceId }, select: { id: true } });
  if (!acc) throw new BadRequestException("conta inexistente no workspace");
}
```
  - `SpendingService.get(workspaceId, filter)`: `assertScopeAccount`; calcular `byCategory` do período e do período anterior com a mesma função privada `categoryTotals(workspaceId, period, scope)` (SQL de despesas: `FROM transactions t LEFT JOIN categories c ON c."id" = t."categoryId" LEFT JOIN bank_accounts a ON a."id" = t."accountId" WHERE t."workspaceId" = ${ws} AND t."type" = 'expense' AND t."date" >= ${from}::date AND t."date" <= ${to}::date ${reportableSql("t")} ${scopeSql(scope)} GROUP BY t."categoryId", c."name"`), unindo por `categoryId` (`"__none"` para nulos, nome `"Sem categoria"`); `pct = round(total / totalCents × 100)`; `insight = biggestMover(...)`. `byMonth`: janela `lastMonths(periodEndYm, 12)`, uma consulta agrupando `to_char(t."date", 'YYYY-MM')` e categoria no intervalo `[primeiroMes-01, fim do período]`, repassada a `stackByMonth(rows, months, 6)`. `vsBudget`: orçamentos `method = 'fixed'` com `categoryId` e `limitCents` do workspace; `limitCents × periodMonths(period).length`; `spentCents` vem de `byCategory`; `pct = round(spent/limit×100)`. `topCounterparties`: `GROUP BY COALESCE(NULLIF(t."counterparty", ''), t."description")`, `ORDER BY total DESC LIMIT 15`, ignorando nomes nulos. `recurring`: despesas dos 12 meses que terminam no fim do período (até 20000 linhas, `ORDER BY date`), mapeadas para `RecurringInput` (`installment: installmentTotal != null`, descrição = `COALESCE(description, counterparty)`), passadas a `detectRecurring`. Sempre converter `bigint` → `Number`.
  - `BalancesService.accountBalances`: uma consulta com `LEFT JOIN transactions t ON t."workspaceId" = a."workspaceId" AND (t."accountId" = a."id" OR t."sourceAccountId" = a."id" OR t."destAccountId" = a."id") AND t."date" <= ${asOf}::date` e `a."openingBalanceCents" + COALESCE(SUM(CASE WHEN t."type"='income' AND t."accountId"=a."id" THEN t."amountCents" WHEN t."type"='expense' AND t."accountId"=a."id" THEN -t."amountCents" WHEN t."type"='transfer' AND t."destAccountId"=a."id" THEN t."amountCents" WHEN t."type"='transfer' AND t."sourceAccountId"=a."id" THEN -t."amountCents" ELSE 0 END), 0)`; filtros `a."archived" = false`, entidade e conta do escopo; **sem** `reportableSql` (saldo reflete o banco). `asOf` omitido → sem limite de data.
  - Controller: `@Get("spending")` com `@Query() query: Record<string, string>`; todas as rotas novas ficam **antes** de `@Get()` raiz não é necessário (caminhos distintos).
- [ ] **Step 4: Rodar** — e2e `dashboards` verde (sozinho), `pnpm --filter @app/api test -- agregacao finance chat` (regressão do saldo e do chat), `pnpm typecheck --force`.
- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): filtro global do dashboard, saldos em SQL e GET /dashboard/spending"`

---

### Task 6: `GET /dashboard/cards`

**Files:**
- Create: `apps/api/src/dashboard/cards.service.ts`
- Modify: `apps/api/src/dashboard/dashboard.controller.ts`, `apps/api/src/dashboard/dashboard.module.ts`
- Test: `apps/api/test/e2e/dashboards.e2e.test.ts` (bloco "cards")

**Interfaces:**
- Consumes: `recentCycles`, `cycleOf`, `cycleClosingIn`, `addMonths`, `addDaysISO`, `daysBetweenISO` (shared), `parseDashboardFilter`/`scopeSql`/`assertScopeAccount` (Task 5), `BalancesService.accountBalances` (Task 5).
- Produces:
  - `GET /dashboard/cards` → `{ cards: Card[] }` com
    `Card = { accountId, name, entity, configured: boolean, closingDay, dueDay, creditLimitCents: number|null, usedCents: number, limitUsedPct: number|null, openInvoiceCents: number|null, closingDate: string|null, dueDate: string|null, cycleDaily: Array<{ day: number; currentCents: number|null; avgPreviousCents: number }>, installmentsAhead: Array<{ month: string; amountCents: number; count: number }>, invoicePayments: Array<{ closing: string; due: string; invoiceCents: number; paidCents: number; status: "paid"|"partial"|"open"|"overdue" }> }`
  - `CardsService.installmentsAheadMonthly(workspaceId, scope, asOf): Promise<Array<{ month: string; amountCents: number }>>` — usado também pela Task 7 (previsão).
  - O filtro de período **não** restringe os cartões (a fatura é sempre a atual); `entity`/`accountId` valem; `asOf` define "hoje".

- [ ] **Step 1: Testes que falham.** Seed: workspace com conta PF `Cartão` (`credit_card`, entity `pf`, `closingDay 10`, `dueDay 17`, `creditLimitCents 500000`, saldo inicial 0), `asOf=2026-06-20` (ciclo aberto fecha 2026-07-10, começa 2026-06-11, vence 2026-07-17). Lançamentos na conta do cartão: despesa 10000 em 12/06; despesa 20000 em 15/06 com `description "LOJA X 02/10"`, `installmentCurrent 2`, `installmentTotal 10`; receita **não pareada** 3000 em 18/06 (estorno); despesa 40000 em 20/05 (ciclo que fechou em 10/06); receita **pareada** (`transferPairId "pp"`) 40000 em 14/06 (pagamento). Esperado: `openInvoiceCents 27000`; `closingDate "2026-07-10"`, `dueDate "2026-07-17"`; `usedCents 27000` e `limitUsedPct 5.4` (saldo da conta = 3000 + 40000 − 10000 − 20000 − 40000 = −27000; `limitUsedPct` com 1 casa); `cycleDaily` tem `currentCents` 10000 no dia 2, 30000 no dia 5, 27000 no dia 8 (acumulado líquido) e `null` do dia 11 em diante, e `avgPreviousCents` numérico em todos os dias; `installmentsAhead` com 12 meses a partir de `2026-08`, os 8 primeiros `{ amountCents: 20000, count: 1 }` (parcelas 3 a 10) e os demais `0`; `invoicePayments` com 1 item (`closing "2026-06-10"`, `due "2026-06-17"`, `invoiceCents 40000`, `paidCents 40000`, `status "paid"`) — ciclos fechados sem movimento não aparecem. Casos extras: cartão sem `closingDay/dueDay` → `configured false` e `openInvoiceCents null`; `entity=pj` não lista o cartão PF; fatura vencida sem pagamento → `status "overdue"`; pagamento parcial → `"partial"`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar `CardsService.get(workspaceId, filter)`.** Para cada conta `credit_card` não arquivada no escopo (`entity`/`accountId`; carregar com Prisma): se faltar `closingDay` ou `dueDay`, devolver o card com `configured: false` e campos numéricos nulos/vazios; senão `recentCycles(asOf, closingDay, dueDay, 6)`. Uma consulta SQL por conta para o intervalo `[primeiro início, asOf]` trazendo `date`, `type`, `amountCents`, `transferPairId IS NOT NULL AS paired`, `installmentCurrent`, `installmentTotal`, `description`; o resto é cálculo em JS: fatura de um ciclo = Σ despesa − Σ receita não pareada com `date ∈ [start, closing]`; `paidCents` = Σ receita pareada com `date ∈ (closing, closingSeguinte]` onde o fechamento seguinte é o `closing` do ciclo seguinte (para o último fechado, o `closing` do ciclo aberto) limitado a `asOf`; `status`: `paid` se `paid >= invoice`, `partial` se `paid > 0`, senão `overdue` se `due < asOf`, senão `open`. `cycleDaily`: índice de dia `1..N` (N = duração do maior entre o ciclo aberto e os 3 últimos fechados), `currentCents` = acumulado líquido do ciclo aberto até o dia (nulo após `asOf`), `avgPreviousCents` = média, nos 3 ciclos fechados anteriores, do acumulado líquido no mesmo índice (ciclos mais curtos repetem o último acumulado). `installmentsAhead`: pegar, por `(normalizeDescriptionKey(description))`, a linha com maior `installmentCurrent` (com `installmentTotal`); `restantes = total − current`; ocorrências nos meses `ym(ciclo da linha) + 1 .. + restantes`, valor = `amountCents` da linha; somar por mês dentro da janela `openYm+1 .. openYm+12` (sempre 12 entradas, zeros incluídos). `usedCents = max(0, −saldo)` com `BalancesService.accountBalances({ accountId })`; `limitUsedPct = limite ? round1(used / limite × 100) : null`. `installmentsAheadMonthly` soma `installmentsAhead` de todos os cartões do escopo por mês.
- [ ] **Step 4: Rodar** — e2e `dashboards` (sozinho), `pnpm typecheck --force`.
- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): GET /dashboard/cards (fatura aberta, ciclo, parcelas e pagamentos)"`

---

### Task 7: `GET /dashboard/cashflow` e `GET /dashboard/summary`

**Files:**
- Create: `apps/api/src/dashboard/cashflow.service.ts`, `apps/api/src/dashboard/summary.service.ts`
- Modify: `apps/api/src/dashboard/dashboard.controller.ts`, `apps/api/src/dashboard/dashboard.module.ts` (importar `BalancesModule` se o serviço for injetado; ou instanciar via módulo exportado)
- Test: `apps/api/test/e2e/dashboards.e2e.test.ts` (blocos "cashflow" e "summary")

**Interfaces:**
- Consumes: Tasks 1–6 (`forecastCashflow`, `detectRecurring`, `BalancesService.accountBalances`, `CardsService`, `SpendingService`).
- Produces:
  - `GET /dashboard/cashflow` → `{ balances: { accounts: Array<{accountId,name,type,entity,balanceCents}>, consolidated: { pfCents, pjCents, totalCents } }, monthly: Array<{ month, incomeCents, expenseCents, transfersNetCents, balanceCents }> (12 meses terminando no mês de `asOf`), forecast: ForecastMonth[] (3 meses, a partir do mês seguinte a `asOf`) }`. `consolidated` é calculado **sem** o filtro de entidade (PF, PJ e total do workspace; só `accountId` ignora, para sempre mostrar o consolidado); `accounts` respeita o escopo.
  - `GET /dashboard/summary` → `{ balances: { pfCents, pjCents, totalCents }, pendingCount: number, nextInvoice: { accountId, name, dueDate, openInvoiceCents } | null, spending: { totalCents, insight, byCategory: top 6, byMonth, vsBudget } }` (o bloco `spending` é o do Painel com `month` de `asOf`, com `byCategory` cortado em 6; `byMonth` com 12 meses).

- [ ] **Step 1: Testes que falham.** Seed "cashflow", `asOf=2026-06-20`: PF1 (checking, pf, saldo inicial 100000), PJ1 (checking, pj, saldo inicial 50000). Junho/2026: PF1 receita 200000 e despesa 50000; par `p1` = despesa 30000 em PF1 + receita 30000 em PJ1; PJ1 receita 100000 e despesa 20000. `ScheduledBill` mensal "Internet" 10000 com `dueDate 2026-07-05`. Esperado (entity ausente): `consolidated` = `{ pfCents: 220000, pjCents: 160000, totalCents: 380000 }`; `monthly` tem 12 itens, o último `2026-06` com `incomeCents 300000`, `expenseCents 70000`, `transfersNetCents 0`, `balanceCents 380000`, e os meses anteriores com `balanceCents 150000` (só saldos iniciais); `forecast`: 3 meses `2026-07..2026-09`, `incomeCents 0`, `billsCents 10000`, `expenseCents 10000`, `balanceCents` 370000 / 360000 / 350000. `entity=pj`: `monthly` de junho com `incomeCents 100000`, `expenseCents 20000`, `transfersNetCents 30000`, `balanceCents 160000`; `entity=pf`: `incomeCents 200000`, `expenseCents 50000`, `transfersNetCents -30000`, `balanceCents 220000`; `consolidated` idêntico em todos os casos. Recorrência no forecast: três despesas "Aluguel" de 100000 em 10/04, 10/05, 10/06 aparecem em `recurringCents` no forecast e a conta agendada "Aluguel" não é somada em dobro. Parcelas: card com parcela futura entra em `installmentsCents` do mês certo.
  Seed "summary": reaproveitar o seed acima mais duas despesas `reviewStatus "pending"` sem categoria e uma pendente pareada (não conta) e um cartão como o da Task 6: `pendingCount 2`; `nextInvoice` aponta o cartão com `dueDate` futuro mínimo e `openInvoiceCents`; `spending.byCategory` tem no máximo 6 itens; `balances` = o consolidado.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** `CashflowService.get`: `balances.accounts` via `accountBalances(scope)`; `consolidated` via `accountBalances({})` agrupando por `entity`; `monthly`: uma consulta agrupada por `to_char(t."date",'YYYY-MM')` com `SUM(CASE WHEN type='income' AND reportable THEN amount END)`, `SUM(... expense ...)` e `transfersNet` = Σ receita **pareada** − Σ despesa **pareada** (`transferPairId IS NOT NULL AND ignored = false`), tudo com `scopeSql` (join `bank_accounts a`); o saldo do fim de cada mês = `Σ openingBalanceCents` das contas do escopo + movimento líquido acumulado até o mês. O movimento líquido (receitas − despesas ± transferências, **incluindo** pares e ignorados, como no saldo) vem de uma única consulta com `GROUP BY` mensal usando as mesmas `CASE` de `accountBalances`, mais uma consulta para o movimento anterior à janela; acumular em JS. O teste prova que o saldo do último mês bate com `Σ accountBalances` do escopo. `forecast`: `history` = meses fechados entre `asOf` e 6 meses antes (`lastMonths(addMonths(asOfYm, -1), 6)`, zeros incluídos), `historyInstallmentsAvgCents` = média mensal das despesas com `installmentTotal != null` nesses meses, `recurring` = `detectRecurring` sobre as despesas dos últimos 12 meses (como na Task 5), `bills` = `ScheduledBill` ativas do workspace, `installments` = `CardsService.installmentsAheadMonthly`, `startBalanceCents` = saldo total do escopo, `firstMonth = addMonths(asOfYm, 1)`, `months = 3`. `SummaryService.get`: compor `CashflowService` (só `consolidated`), `prisma.transaction.count({ where: { workspaceId, reviewStatus: "pending", ...REPORTABLE } })`, `CardsService` (menor `dueDate >= asOf` com fatura aberta > 0) e `SpendingService` (limitando `byCategory` a 6).
- [ ] **Step 4: Rodar** — e2e `dashboards` (sozinho) e o restante da API: `pnpm --filter @app/api test` (sozinho, sem outro e2e em paralelo), `pnpm typecheck --force`.
- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): GET /dashboard/cashflow (com previsão) e GET /dashboard/summary"`

---

### Task 8: Fundação do web — roteador, tokens, tema e casca do app

**Files:**
- Create: `apps/web/src/router.ts`, `apps/web/src/stores/theme.ts`, `apps/web/src/views/RegrasView.vue`
- Modify: `apps/web/src/main.ts`, `apps/web/src/App.vue` (casca com `<RouterView>`), `apps/web/src/styles/tokens.css`, `apps/web/src/views/ReviewView.vue` e `SharedEntryView.vue` (navegação por rota em vez de `tab`), `apps/web/vite.config.ts` (`workbox.navigateFallback: "/index.html"` e `navigateFallbackDenylist: [/^\/api/]`)
- Test: `apps/web/src/lib/__tests__/router-paths.test.ts`, `apps/web/src/stores/__tests__/theme.test.ts`

**Interfaces:**
- Produces: rotas `/` (InicioView, Task 11), `/painel` (PainelView, Task 10), `/contas`, `/transacoes`, `/importar`, `/categorizar`, `/regras`, `/orcamentos`, `/metas`, `/membros`, `/chat`, `/lancar` (IngestView), `/insights`, `/ajustes` (AjustesView, Task 11); `/lancar/compartilhado` continua indo para `SharedEntryView` fora da casca (e continua funcionando com `?token=` de convite como hoje). Enquanto as Tasks 10 e 11 não existem, `/`, `/painel` e `/ajustes` apontam para a `DashboardView` atual e para um `EmptyState` temporário — substituir nas Tasks 10 e 11. `useThemeStore()` com `mode: "system"|"light"|"dark"`, `setMode(mode)`, `toggle()`; aplica `document.documentElement.dataset.theme` (`light`/`dark`; `system` remove o atributo) e persiste em `localStorage` com `try/catch`.
- Tokens (`tokens.css`): `:root` claro por padrão com `@media (prefers-color-scheme: dark)` sob `:root:not([data-theme="light"])` e `:root[data-theme="dark"]`; variáveis `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--accent`, `--accent-text`, `--c-income`, `--c-expense`, `--c-transfer`, `--c-pf`, `--c-pj`, `--danger`, `--warning`, `--radius`, `--space`, `--font-sans`, `--font-num`; manter aliases `--color-bg`, `--color-surface`, `--color-primary`, `--color-text` apontando para os novos (as views antigas ainda os usam).

- [ ] **Step 1: Testes que falham.**
  - `theme.test.ts` (jsdom): `setMode("dark")` define `data-theme="dark"` e grava no `localStorage`; `setMode("system")` remove o atributo; `localStorage` que lança erro não quebra; `toggle()` alterna claro/escuro a partir do modo efetivo.
  - `router-paths.test.ts`: importar `routes` de `../../router` e verificar que cada caminho da lista de constraints existe, que `/lancar/compartilhado` aponta para um componente diferente de `/lancar`, e que uma rota desconhecida cai em `/`.
- [ ] **Step 2: Implementar.** `router.ts` exporta `routes` e `router = createRouter({ history: createWebHistory(), routes })` (carregamento preguiçoso `() => import(...)` para as views maiores). `main.ts` usa `.use(router)`. `App.vue`: autenticado → `<div class="shell">` com `<aside class="sidebar">` (logo, links `RouterLink` agrupados — "Visão" [Início, Painel], "Lançamentos" [Transações, Para categorizar, Importar, Lançar por IA], "Planejamento" [Orçamentos, Metas, Insights], "Cadastros" [Contas, Regras, Membros, Ajustes], "Chat IA"; rodapé com `WorkspaceSwitcher`, botão de tema, "Instalar app" e "Sair"), `<main>` com `<RouterView />`, e `<nav class="bottom-nav">` no celular (Início, Painel, Lançar, Chat, Mais → `/contas`); `@media (max-width: 768px)` esconde a sidebar. Convite (`?token=`) e `LoginView` mantêm o comportamento atual (renderizados no lugar da casca). `RegrasView.vue` é um invólucro fino que renderiza `RulesPanel` em tela cheia. Trocar toda navegação por `tab` (em `onSharedDone` etc.) por `router.replace`/`push`. Atualizar `tokens.css` conforme acima.
- [ ] **Step 3: Rodar** — `pnpm --filter @app/web test && pnpm --filter @app/web typecheck`; abrir `pnpm dev` e conferir manualmente que cada rota carrega, que recarregar a página em `/painel` funciona e que `/lancar/compartilhado` ainda abre.
- [ ] **Step 4: Commit** — `git add apps/web && git commit -m "feat(web): roteador, tokens claro/escuro e casca com navegação lateral"`

---

### Task 9: Componentes base e tokens aplicados em todas as telas

**Files:**
- Create: `apps/web/src/components/ui/Card.vue`, `DataTable.vue`, `EntityBadge.vue`, `PeriodPicker.vue`, `FilterBar.vue`, `Money.vue`, `EmptyState.vue`, `apps/web/src/lib/money.ts`
- Modify: todas as views e componentes que hoje têm cores fixas (`#222`, `#333`, `#2ecc71`, `#e74c3c`, `#4f7cff`, `rgba(79,124,255,…)`): `AccountsView`, `BudgetsView`, `ChatView`, `GoalsView`, `ImportView`, `IngestView`, `InsightsView`, `InviteAcceptView`, `LoginView`, `MembersView`, `ReviewView`, `SharedEntryView`, `TransactionsView`, `DashboardView`, `RulesPanel`, `WorkspaceSwitcher`, `AccountFields`, `ChatChart`
- Test: `apps/web/src/lib/__tests__/money.test.ts`

**Interfaces:**
- Produces: `formatBRL(cents: number): string` (`R$ 1.234,56`, negativo com sinal), `formatBRLCompact(cents)` (`R$ 1,2 mil`/`R$ 3,4 mi`), `signedClass(cents)` → `"pos"|"neg"|"zero"`; componentes: `Card` (props `title?`, `value?`, `insight?`, `to?` — quando `to` existe o card inteiro é um `RouterLink`; slots padrão e `actions`), `Money` (prop `cents`, `colored?`, `compact?`; usa `tabular-nums`), `EntityBadge` (prop `entity: "pf"|"pj"`; usa `--c-pf`/`--c-pj`), `EmptyState` (props `title`, `hint?`), `FilterBar` (slot; faixa fixa com quebra em linhas), `PeriodPicker` (v-model de `{ kind, value }`: abas Mês / Trimestre / Ano / Intervalo com os inputs correspondentes; emite `update:modelValue` com objeto `{ month? , quarter?, year?, from?, to? }`), `DataTable` (props `columns: Array<{ key, label, align?, class? }>` e `rows`, slot por coluna `cell-<key>`, estado vazio via `EmptyState`).

- [ ] **Step 1: Teste que falha** — `money.test.ts`: `formatBRL(123456)` contém `1.234,56`; `formatBRL(-5)` contém `-` e `0,05`; `formatBRLCompact(120_000_00)` → `R$ 120 mil`; `formatBRLCompact(2_500_000_00)` → `R$ 2,5 mi`; `signedClass` para `5`, `-5`, `0`.
- [ ] **Step 2: Implementar** os componentes (SFCs pequenos, estilos só com tokens) e `money.ts` (usar `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`; o compacto é manual: ≥ 1_000_000_00 → mi, ≥ 1_000_00 → mil, senão `formatBRL`).
- [ ] **Step 3: Aplicar tokens.** Em cada view/componente listado, substituir cores fixas por tokens (`#222`/`#333` → `var(--border)`; `#2ecc71` → `var(--c-income)`; `#e74c3c` → `var(--c-expense)`; fundos `rgba(79,124,255,…)` → `color-mix(in srgb, var(--accent) 15%, transparent)`; `#4f7cff` → `var(--accent)`), trocar `<input>`/`<select>`/botões soltos pelos estilos globais de formulário definidos em `tokens.css` (bloco `input, select, textarea, button` com borda, raio e foco visível) e usar `EntityBadge`/`EmptyState`/`Money` onde já havia equivalente ad hoc (`ENTITY_SHORT` em Contas/Transações/Para categorizar). Não mudar comportamento nem textos. `ChatChart.vue` passa a ler as cores do tema (ver `EChart.vue` na Task 10: extrair um helper `themeColors()` em `apps/web/src/lib/theme-colors.ts`, lendo `getComputedStyle(document.documentElement)`).
- [ ] **Step 4: Rodar** — `pnpm --filter @app/web test && pnpm --filter @app/web typecheck`; conferir no navegador, em claro e escuro, que nenhuma tela ficou ilegível (texto sobre fundo) — `grep -rn "#[0-9a-fA-F]\{3,6\}" apps/web/src --include=*.vue` não deve achar cores fixas fora de `tokens.css` (exceção: cores de gráfico em `dashboard-charts.ts` da Task 10).
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): componentes base e tokens de tema aplicados em todas as telas"`

---

### Task 10: Painel — filtro global na URL, três blocos e gráficos

**Files:**
- Create: `apps/web/src/lib/dashboard-client.ts`, `apps/web/src/lib/dashboard-charts.ts`, `apps/web/src/components/charts/EChart.vue`, `apps/web/src/lib/theme-colors.ts` (se ainda não existir), `apps/web/src/views/PainelView.vue`
- Modify: `apps/web/src/router.ts` (`/painel` → `PainelView`), `apps/web/src/views/TransactionsView.vue` (ler `from/to/categoryId/accountId/entity/q` da query da rota e aplicá-los ao carregar — `TransactionsView` só filtra por texto/conta/entidade hoje; acrescentar `categoryId` e as datas à chamada `store.loadTransactions`), `apps/web/src/lib/api.ts` (tipos e `api.dashboard.spending/cards/cashflow/summary`)
- Test: `apps/web/src/lib/__tests__/dashboard-client.test.ts`, `apps/web/src/lib/__tests__/dashboard-charts.test.ts`

**Interfaces:**
- Consumes: os 4 endpoints das Tasks 5–7, `Card`, `Money`, `PeriodPicker`, `FilterBar`, `EntityBadge`, `EmptyState` (Task 9).
- Produces:
  - `dashboard-client.ts`: `type PainelFilter = { entity: "all"|"pf"|"pj"; accountId: string; month?: string; quarter?: string; year?: string; from?: string; to?: string }`; `filterFromQuery(query: Record<string, string | string[] | undefined>): PainelFilter` (valida; valores inválidos voltam ao padrão: mês atual, entidade `all`); `filterToQuery(f): Record<string,string>` (omite vazios e `all`); `filterToParams(f): URLSearchParams` (mesmos nomes de parâmetro da API); `transactionsLink(f, extra: { categoryId?: string; from?: string; to?: string }): { path: "/transacoes"; query: Record<string,string> }` — converte o período do filtro em `from`/`to` (mês → primeiro e último dia, trimestre, ano) e acrescenta `entity`/`accountId`.
  - `dashboard-charts.ts` (funções puras que devolvem `EChartsOption`): `spendingPie(byCategory)`, `spendingStack(byMonth)`, `budgetBars(vsBudget)`, `cardDailyLine(cycleDaily)`, `installmentsBars(installmentsAhead)`, `cashflowBars(monthly)` (barras de receita/despesa + linha do saldo), `forecastLine(monthly, forecast)`; todas recebem `colors` (de `themeColors()`) como último argumento e formatam valores com `formatBRL`; valores em centavos, eixo em reais.
  - `EChart.vue`: props `option`, `height?` (padrão 280); registra uma única vez `PieChart, BarChart, LineChart` e os componentes `Title/Tooltip/Legend/Grid/Dataset`, `CanvasRenderer`; observa mudança de `option` e de tema (`MutationObserver` em `document.documentElement` para `data-theme` e `matchMedia('(prefers-color-scheme: dark)')`); `ResizeObserver` para redimensionar; emite `click` com `{ name, seriesName, dataIndex }`; descarta a instância no `onBeforeUnmount`.
  - `PainelView.vue`: `FilterBar` com `PeriodPicker`, seletor Todas/PF/PJ e seletor de conta (somente contas da entidade escolhida); o estado vive em `route.query` (`router.replace` a cada mudança, sem recarregar a página); três seções na ordem da spec, cada uma com `Card`s de gráfico: **1. Para onde vai o dinheiro** (total + insight, pizza por categoria — clique abre `transactionsLink(f, { categoryId })`, barras empilhadas por mês, barras de orçamento, tabela "Maiores destinos", tabela "Recorrentes"); **2. Cartões e faturas** (um painel por cartão: fatura aberta, fechamento, vencimento, `limitUsedPct` com barra, linha do ciclo atual × média, barras de parcelas, tabela de pagamentos com selo de status; cartão `configured: false` mostra `EmptyState` com link para `/contas`); **3. Fluxo de caixa** (saldos por conta com `EntityBadge`, consolidado PF/PJ/total, barras mensais + saldo, linha de previsão de 3 meses, `transfersNetCents` mostrado como linha de texto "Transferências internas no mês" quando houver filtro de entidade). Estados de carregando/erro/vazio por seção; recarrega só o que muda (`spending`, `cards` e `cashflow` em paralelo, cada um com seu próprio `loading/error`); descartar respostas antigas quando o filtro muda durante a requisição (contador de requisição).

- [ ] **Step 1: Testes que falham.**
  - `dashboard-client.test.ts`: `filterFromQuery({})` → mês atual (injetar `today`), entidade `all`; query `{ entity: "pj", month: "2026-06", accountId: "x" }` preservada; `{ month: "2026-13" }` volta ao padrão; `{ month: "2026-06", year: "2026" }` mantém só o primeiro tipo válido (decisão: mês vence); `filterToQuery` omite vazios e `entity=all`; `filterToParams` serializa; `transactionsLink` de `month=2026-06` com `categoryId "c1"` → `from=2026-06-01`, `to=2026-06-30`, `categoryId=c1`; trimestre `2026-Q2` → `2026-04-01..2026-06-30`; ano; intervalo; com `entity=pj` e conta inclui ambos na query.
  - `dashboard-charts.test.ts`: `spendingPie` devolve série `pie` com um item por categoria, valores em reais (centavos/100) e cores vindas de `colors`; `spendingStack` devolve uma série `bar` empilhada (`stack: "total"`) por série da API, `xAxis.data` igual aos meses; `budgetBars` marca em `--danger` a barra com `pct > 100`; `cardDailyLine` tem duas séries e a série "atual" para na linha dos dias `null`; `cashflowBars` tem 2 séries de barra + 1 linha em eixo secundário ou mesmo eixo; `forecastLine` concatena meses reais e previstos com a previsão tracejada; nenhuma função lança com listas vazias.
- [ ] **Step 2: Implementar** `dashboard-client.ts`, `dashboard-charts.ts`, `EChart.vue`, tipos/`api.dashboard.*` em `api.ts`, `PainelView.vue`, rota `/painel`, e a leitura de query em `TransactionsView.vue` (os campos `from`, `to`, `categoryId`, `accountId`, `entity`, `q` da rota alimentam os filtros iniciais; a lista aceita `categoryId` em `loadTransactions`).
- [ ] **Step 3: Rodar** — `pnpm --filter @app/web test && pnpm --filter @app/web typecheck`.
- [ ] **Step 4: Verificação visual** — subir `docker compose up -d`, `pnpm dev` (API + web + worker) e, com o navegador do app, importar os extratos de teste de `apps/api/test/e2e/__fixtures__` ou criar lançamentos de exemplo via `POST /transactions`; conferir os três blocos em claro e escuro, em largura de celular (375px) e de desktop, que trocar mês/entidade atualiza a URL e os gráficos, que recarregar a página mantém o filtro e que clicar numa fatia da pizza abre a lista de transações já filtrada. Parar os servidores ao final.
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): Painel com filtro global na URL, gráficos ECharts e três blocos"`

---

### Task 11: Início (resumo), Ajustes e selos/desfazer na lista de transações

**Files:**
- Create: `apps/web/src/views/InicioView.vue`, `apps/web/src/views/AjustesView.vue`, `apps/web/src/lib/settings-client.ts`
- Modify: `apps/web/src/router.ts` (`/` → `InicioView`, `/ajustes` → `AjustesView`), `apps/web/src/views/TransactionsView.vue` (selos e ações), `apps/web/src/lib/api.ts` (campos novos de `Transaction`, `api.review.unpair/unignore`), `apps/api/src/review/review.service.ts` + `review.controller.ts` (`POST /review/unignore`), remover a `DashboardView.vue` antiga e `dashboard-format.ts`/`dashboard-breakdown.test.ts` se nada mais os usar (o contrato `GET /dashboard` do servidor permanece)
- Test: `apps/web/src/lib/__tests__/settings-client.test.ts`, `apps/api/test/e2e/revisao.e2e.test.ts` (unignore)

**Interfaces:**
- Consumes: `GET /dashboard/summary`, `GET/PATCH /workspaces/current/settings` (já existe; `workspaceSettingsUpdateSchema`: `aiConfidenceThreshold` 0–1, `aiBatchSize` 1–200, `transferMatchWindowDays` 0–10, `ownerNames` até 20 strings), `POST /review/unpair` (`{ transferPairId }`), `POST /review/ignore`.
- Produces:
  - `POST /review/unignore` com corpo `{ transactionIds: string[] }` → `{ unignored: number }`: `updateMany` com `where: { id: { in }, workspaceId, ignored: true }` e `data: { ignored: false, reviewStatus: categoryId null ? "pending" : "ok" }` — como `updateMany` não condiciona por coluna da própria linha, fazer dois `updateMany` (com `categoryId: null` → `pending`/`categorySource none`; com `categoryId: { not: null }` → `ok`) dentro de `$transaction`; 404 se nenhuma linha mudou.
  - `settings-client.ts`: `parseOwnerNames(text: string): string[]` (separa por vírgula ou quebra de linha, `trim`, remove vazios e duplicados sem diferenciar maiúsculas, máximo 20) e `formatOwnerNames(names: string[]): string`; `validateSettingsForm(form)` devolvendo `{ ok: true, value } | { ok: false, errors: Record<string,string> }` com as mesmas faixas do schema.
  - `InicioView`: saudação curta, cartões de saldo (PF, PJ, total, usando `Money` e `EntityBadge`), card "Para categorizar" (`pendingCount`, link `/categorizar`), card "Próxima fatura" (cartão, vencimento, valor, link `/painel#cartoes`), e 3 gráficos do bloco 1 (pizza do mês, empilhado de 12 meses, barras de orçamento) com os mesmos `dashboard-charts`; botão "Abrir o painel" → `/painel`.
  - `AjustesView`: formulário de `ownerNames` (textarea, uma entrada por linha ou separada por vírgula, com explicação de que são os nomes do titular e da empresa como aparecem nos extratos e que sem eles o Pix entre as suas contas não é pareado), limiar de confiança da IA (campo numérico 0–1 com a explicação "abaixo disso o lançamento vai para Para categorizar"), tamanho de lote, janela de pareamento em dias; salvar via `PATCH`, mostrar o 403/erro devolvido pela API para quem não for dono/admin; seletor de tema (Sistema/Claro/Escuro) usando `useThemeStore`.
  - `TransactionsView`: coluna/selo "Transferência pareada" (`transferPairId`) com botão **Desfazer par** (chama `unpair` e recarrega), selo "Ignorado" com botão **Reativar** (`unignore`), selo "Parcela n/m" quando houver `installmentCurrent/Total`, selo "Sem categoria" (`reviewStatus pending`) e origem da categoria em texto discreto (`categorySource`: manual/regra/IA/importação); filtro rápido "Mostrar: todos | pareados | ignorados | pendentes".

- [ ] **Step 1: Testes que falham.**
  - `settings-client.test.ts`: `parseOwnerNames("Maria Silva, Empresa LTDA\nmaria silva")` → `["Maria Silva","Empresa LTDA"]`; 25 nomes → 20; `formatOwnerNames` faz o caminho inverso (um por linha); `validateSettingsForm` aceita `{0.8, 40, 2, ["a"]}` e recusa `threshold 1.5`, `batch 0`, `window 11`, 21 nomes com a mensagem do campo.
  - e2e `revisao`: `POST /review/unignore` volta a linha ignorada com categoria para `ok` e a sem categoria para `pending` (aparece em `GET /review/pending`); linha que não está ignorada/de outro workspace → 404; corpo vazio → 400.
- [ ] **Step 2: Implementar** os itens acima. Remover a `DashboardView.vue` antiga e o que ficar sem uso (conferir com `grep`); manter `ChatChart.vue`.
- [ ] **Step 3: Rodar** — `pnpm --filter @app/web test && pnpm --filter @app/web typecheck`, e2e `revisao` (sozinho), `pnpm typecheck --force`.
- [ ] **Step 4: Verificação visual** — no navegador do app: Início com saldos e gráficos; Ajustes salvando `ownerNames` e limiar (conferir pelo `GET /workspaces/current/settings`); Transações mostrando selos, desfazendo um par e reativando um ignorado; claro/escuro e 375px.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: Início com resumo, tela de Ajustes e selos/desfazer na lista de transações"`

---

### Task 12: Verificação final, dados reais e documentação

**Files:**
- Modify: `README.md` (contagens de testes, seção de dashboards e de Ajustes, rotas, migrations: 13), `docs/superpowers/plans/2026-10-01-fase-13-dashboards.md` (marcar os passos)
- Test: nenhum novo; conferência ponta a ponta

- [ ] **Step 1: Suítes completas, uma de cada vez** — `pnpm typecheck --force`, `pnpm test` (nunca com outro e2e ou o `pnpm dev` com worker rodando; e2e compartilham o banco), `pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` → "empty migration".
- [ ] **Step 2: Dados reais** — subir os serviços e importar os PDFs reais do C6 (PF e PJ, em `~/Downloads/Extrato C6 Bank PF.pdf` e `PJ.pdf`) pelo fluxo da tela Importar; conferir no Painel que: total de despesas do mês bate com a soma das linhas do extrato (fora transferências), saldos por conta batem com os saldos finais dos extratos, a previsão de 3 meses não explode (ordem de grandeza coerente com a média histórica), a lista de recorrentes é plausível e o resumo do Início mostra o pendente. Anotar discrepâncias no relatório da task em vez de "corrigir de cabeça".
- [ ] **Step 3: Documentar** — README: tabela de testes com as contagens reais, descrição curta de Painel/Início/Ajustes, `asOf`, regras de fatura e previsão (decisões 4 e 7), e atualizar "Estado do projeto" (Fase 13 concluída, restos para backlog: parser de fatura do C6, Mercado Pago/BB/Inter, deploy). Marcar os passos deste plano.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "docs: fecha a Fase 13 (plano marcado, README com dashboards, ajustes e contagens)"`
