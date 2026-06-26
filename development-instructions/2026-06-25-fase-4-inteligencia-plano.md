# Fase 4 — Inteligência · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps em checkbox.
>
> **Convenção:** scaffolding por comandos; código autoral por completo. Detectores determinísticos testados sem rede; LLM (só narrativa/fallback) mockado. Reusa harness/serviços das Fases 0–2. Repo: `docs/superpowers/plans/2026-06-25-fase-4-inteligencia.md`.

**Goal:** Categorização automática que **aprende** com correções; detecção de **anomalias** e **assinaturas**; **previsão** de saldo; **resumo mensal** narrado; **orçamentos** (fixos e 50/30/20) e **metas/cofrinhos**, com **alertas** num feed de insights.

**Architecture:** Camada determinística (regras + estatística em SQL/TS) faz o trabalho pesado e testável; LLM (OpenRouter) só preenche o que regra não cobre (fallback de categoria) e narra o resumo. Insights/alertas materializados na tabela `insights`. Jobs na fila `ai`: `categorize` (sob demanda/no import) e `compute_insights` (agendado + sob demanda).

**Tech Stack:** SQL (detectores/agregações), OpenRouter (fallback/narrativa, mockado em teste), BullMQ, NestJS, Vue.

## Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Aprendizado de categoria | **Regras explícitas acumuladas** (`category_rules`) aplicadas 1º; **LLM com few-shot** do workspace só no que sobra. Embeddings adiados. |
| 2 | Origem das regras | Toda **correção** de categoria do usuário gera/atualiza uma regra (`contains` no fornecedor/descrição). |
| 3 | Detectores | **Determinísticos** (SQL/TS): pico vs média móvel; assinatura = mesmo fornecedor recorrente; previsão = run-rate. LLM **não** decide número. |
| 4 | Resumo mensal | LLM **apenas narra** os números já calculados. |
| 5 | 50/30/20 | `categories.bucket` (`needs`/`wants`/`savings`) deriva os 3 limites da **renda do mês**. |
| 6 | Metas | `goals` + `goal_contributions` (histórico). Contribuição incrementa `saved_cents` (opcionalmente lança transferência). |
| 7 | Alertas | Materializados como `insights` (`type='budget_alert'` etc.) no mesmo feed. |

## Global Constraints

- Detectores puros/SQL → testes sem rede. LLM atrás de gateway, mockado.
- Insights são idempotentes por `(workspace_id, type, dedup_key, period)` — recomputar não duplica.
- Migrations continuam (próxima: `0015`).

---

## Task 1: `category_rules` + motor de regras

**Files:** Create `supabase/migrations/0015_category_rules.sql`; `packages/shared/src/rules.ts`; Modify `src/index.ts`. Test: `packages/shared/src/__tests__/rules.test.ts`.

**Interfaces:** Produces tabela `category_rules`; `applyRules(text, rules)` e `ruleFromCorrection(tx, categoryId)`. Consumido pelo job de categorização (Task 2) e pelo aprendizado (Task 3).

- [ ] **Step 1: Teste do motor (falha primeiro)** — `rules.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { applyRules, ruleFromCorrection } from "../rules";

const rules = [
  { matchType: "contains", pattern: "ifood", categoryId: "c-rest", priority: 100 },
  { matchType: "equals",   pattern: "uber",  categoryId: "c-transp", priority: 90 },
];

describe("applyRules", () => {
  it("casa por contains (case-insensitive)", () => {
    expect(applyRules("Compra IFOOD SP", rules)).toBe("c-rest");
  });
  it("respeita prioridade e equals", () => {
    expect(applyRules("uber", rules)).toBe("c-transp");
    expect(applyRules("ubereats", rules)).toBeNull(); // equals não casa
  });
  it("sem match → null", () => {
    expect(applyRules("posto shell", rules)).toBeNull();
  });
});

describe("ruleFromCorrection", () => {
  it("deriva contains do fornecedor", () => {
    const r = ruleFromCorrection({ counterparty: "Netflix.com", description: null }, "c-assin");
    expect(r.matchType).toBe("contains");
    expect(r.pattern).toBe("netflix.com");
    expect(r.categoryId).toBe("c-assin");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0015_category_rules.sql`:
```sql
create type rule_match as enum ('contains','equals','regex');

create table category_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  match_type rule_match not null,
  pattern text not null,
  category_id uuid not null references categories(id) on delete cascade,
  priority int not null default 100,
  created_at timestamptz not null default now(),
  unique (workspace_id, match_type, pattern)
);
create index category_rules_ws_idx on category_rules(workspace_id, priority desc);

alter table category_rules enable row level security;
create policy cr_select on category_rules for select using (is_member(workspace_id));
create policy cr_cud on category_rules for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: Motor** — `packages/shared/src/rules.ts`:
```ts
export type Rule = { matchType: "contains"|"equals"|"regex"; pattern: string; categoryId: string; priority: number };

export function applyRules(text: string, rules: Rule[]): string | null {
  const t = text.toLowerCase();
  for (const r of [...rules].sort((a, b) => b.priority - a.priority)) {
    const p = r.pattern.toLowerCase();
    const hit = r.matchType === "equals" ? t === p
      : r.matchType === "contains" ? t.includes(p)
      : new RegExp(r.pattern, "i").test(text);
    if (hit) return r.categoryId;
  }
  return null;
}

export function ruleFromCorrection(
  tx: { counterparty?: string | null; description?: string | null },
  categoryId: string,
): Rule {
  const base = (tx.counterparty ?? tx.description ?? "").trim().toLowerCase();
  const pattern = base.split(/\s+/).slice(0, 3).join(" ") || base;
  return { matchType: "contains", pattern, categoryId, priority: 120 };
}
```

- [ ] **Step 5: Reexportar e ver passar.**

- [ ] **Step 6: Commit** — `git commit -am "feat(ai): category_rules table and deterministic rules engine"`

---

## Task 2: Job de categorização (regras → LLM)

**Files:** Create `apps/worker/src/ai/categorize.processor.ts`; endpoint `POST /transactions/categorize` (lote de não-categorizadas). Test: `apps/worker/test/categorize.test.ts`.

**Interfaces:** Consumes `category_rules`, `categories`, `OpenRouterGateway`. Produces `category_id` preenchido em transações sem categoria. Auto-enfileirado no commit do import (Fase 3).

- [ ] **Step 1: Teste (falha primeiro)** — semeia uma regra `ifood→c` e uma transação "iFood" sem categoria; processa; espera `category_id=c` **sem** chamar o LLM (gateway fake com `parseText` que falha o teste se chamado). Segunda transação sem regra → cai no LLM fake (retorna sugestão) → mapeada.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Processor** — `categorize.processor.ts`: para cada transação sem categoria, monta `text = counterparty||description`, aplica `applyRules`; se null, chama o LLM com few-shot (`select counterparty, name from transactions join categories ... limit 20`) e mapeia por nome (`mapCategory`). Atualiza `transactions.category_id`. Registra `ai_job`.

- [ ] **Step 4: Endpoint** — `POST /transactions/categorize` cria `ai_job` + enfileira as transações sem categoria do workspace.

- [ ] **Step 5: Ver passar.**

- [ ] **Step 6: Commit** — `git commit -am "feat(ai): categorization job (rules first, LLM fallback)"`

---

## Task 3: Aprendizado — correção vira regra

**Files:** Modify `apps/api/src/transactions/*` (PATCH categoria). Test: `apps/api/test/e2e/categorize-learn.e2e.test.ts`.

**Interfaces:** Produces `PATCH /transactions/:id { categoryId }` que (a) atualiza a transação e (b) **upserta** uma `category_rule` via `ruleFromCorrection`. Próximas transações similares são auto-categorizadas.

- [ ] **Step 1: e2e (falha primeiro)** — cria transação "Netflix" sem categoria; `PATCH` define categoria "Assinaturas"; verifica que existe uma `category_rule` `contains netflix → Assinaturas`; cria nova transação "Netflix" e roda categorização → vem categorizada sozinha.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Service** — no `update` de categoria, após persistir, fazer `upsert` em `category_rules` com `ruleFromCorrection(tx, categoryId)` (`onConflict: workspace_id,match_type,pattern`).

- [ ] **Step 4: Ver passar.**

- [ ] **Step 5: Commit** — `git commit -am "feat(ai): learn a category rule from each user correction"`

---

## Task 4: `insights` — feed e leitura

**Files:** Create `supabase/migrations/0016_insights.sql`; `apps/api/src/insights/*`. Test: `apps/api/test/database/insights.test.ts`.

**Interfaces:** Produces tabela `insights` (idempotente por `dedup_key`); `GET /insights`, `PATCH /insights/:id/read`. Alimentada pelas Tasks 5–7.

- [ ] **Step 1: Teste (falha primeiro)** — inserir o mesmo insight (mesmo `dedup_key`+`period`) duas vezes não duplica; RLS isola.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0016_insights.sql`:
```sql
create type insight_type as enum ('spike','subscription','forecast','summary','budget_alert','goal_alert');

create table insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type insight_type not null,
  dedup_key text not null,
  period date,
  payload jsonb not null,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, type, dedup_key, period)
);
create index insights_ws_idx on insights(workspace_id, created_at desc);

alter table insights enable row level security;
create policy ins_select on insights for select using (is_member(workspace_id));
create policy ins_cud on insights for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: API** — `GET /insights` (ordenado, com filtro `?read=`), `PATCH /insights/:id/read`.

- [ ] **Step 5: Ver passar e commit** — `git commit -am "feat(insights): insights feed table, RLS and endpoints"`

---

## Task 5: Detectores — pico e assinatura

**Files:** Create `supabase/migrations/0017_detectors.sql` (RPCs); `apps/worker/src/insights/compute.processor.ts`. Test: `apps/api/test/database/detectors.test.ts`.

**Interfaces:** Produces RPCs `detect_spikes(workspace, month)` e `detect_subscriptions(workspace)`; job `compute_insights` que materializa os resultados em `insights`.

- [ ] **Step 1: Teste (falha primeiro)** — `detectors.test.ts`: semeia 3 meses de "Mercado" ~R$300 e um mês a R$900 → `detect_spikes` retorna a categoria com flag; semeia "Spotify" R$20 em 3 meses consecutivos → `detect_subscriptions` retorna a assinatura.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration (RPCs)** — `supabase/migrations/0017_detectors.sql`:
```sql
-- Pico: gasto da categoria no mês > 1.5x a média dos 3 meses anteriores
create or replace function detect_spikes(p_workspace uuid, p_month date)
returns table (category_id uuid, name text, current_cents bigint, avg_prev_cents numeric)
language sql stable security invoker set search_path = public as $$
  with cur as (
    select t.category_id, sum(t.amount_cents) c
    from transactions t
    where t.workspace_id = p_workspace and t.type='expense'
      and date_trunc('month', t.date) = date_trunc('month', p_month)
    group by t.category_id
  ),
  prev as (
    select t.category_id, avg(m.s) a from (
      select category_id, date_trunc('month', date) mth, sum(amount_cents) s
      from transactions
      where workspace_id = p_workspace and type='expense'
        and date >= date_trunc('month', p_month) - interval '3 months'
        and date <  date_trunc('month', p_month)
      group by category_id, date_trunc('month', date)
    ) m join (select 1) _ on true
    group by t.category_id
  )
  select c.category_id, cat.name, c.c, p.a
  from cur c join prev p on p.category_id = c.category_id
  join categories cat on cat.id = c.category_id
  where is_member(p_workspace) and p.a > 0 and c.c > p.a * 1.5;
$$;

-- Assinatura: mesmo fornecedor (counterparty) em >= 3 meses distintos
create or replace function detect_subscriptions(p_workspace uuid)
returns table (counterparty text, months int, avg_cents numeric)
language sql stable security invoker set search_path = public as $$
  select counterparty,
         count(distinct date_trunc('month', date))::int as months,
         avg(amount_cents) as avg_cents
  from transactions
  where workspace_id = p_workspace and type='expense'
    and counterparty is not null and is_member(p_workspace)
    and date >= current_date - interval '4 months'
  group by counterparty
  having count(distinct date_trunc('month', date)) >= 3;
$$;
```
> Ajuste o `prev` CTE conforme o dialeto (a forma acima ilustra a intenção: média mensal dos 3 meses anteriores por categoria).

- [ ] **Step 4: Processor `compute_insights`** — chama as RPCs e faz `upsert` em `insights` (`type='spike'` com `dedup_key=category_id`, `period=month`; `type='subscription'` com `dedup_key=counterparty`). Idempotente.

- [ ] **Step 5: Ver passar e commit** — `git commit -am "feat(insights): spike and subscription detectors materialized as insights"`

---

## Task 6: Previsão de saldo + resumo narrado

**Files:** Create `supabase/migrations/0018_forecast.sql` (RPC `cashflow_forecast`); Modify `compute.processor.ts`. Test: `apps/api/test/database/forecast.test.ts`, `apps/worker/test/summary.test.ts`.

**Interfaces:** Produces RPC de previsão (run-rate) → insight `forecast`; resumo mensal `summary` cujos **números** vêm da SQL e a **frase** do LLM (mockado).

- [ ] **Step 1: Testes (falham primeiro)** — `forecast`: com gasto de R$1.000 nos primeiros 10 dias de um mês de 30, a projeção de gasto mensal ≈ R$3.000 (run-rate). `summary`: dado um objeto de números, o gateway de narrativa (mockado) é chamado e a string vai pro insight.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: RPC de previsão** — `cashflow_forecast(p_workspace, p_month)`: `projected_expense = (gasto_até_hoje / dia_atual) * dias_no_mês`; `forecast_balance = saldo_consolidado_atual - (projected_expense - gasto_até_hoje) + receita_esperada_restante` (receita esperada = média das receitas dos últimos 3 meses, proporcional aos dias restantes). Retorna os números.

- [ ] **Step 4: Narrativa** — em `compute.processor.ts`, montar o objeto de números (cashflow do mês, top categorias, pico/assinatura, previsão) e chamar `ai.narrate(numbers)` (novo método no gateway, prompt "narre em pt-BR, sem inventar números") → insight `summary`. LLM mockado em teste.

- [ ] **Step 5: Ver passar e commit** — `git commit -am "feat(insights): run-rate forecast and LLM-narrated monthly summary"`

---

## Task 7: Orçamentos (fixo e 50/30/20) + alertas

**Files:** Create `supabase/migrations/0019_budgets.sql` (tabela + `categories.bucket`); `apps/api/src/budgets/*`. Test: `apps/api/test/database/budgets.test.ts`.

**Interfaces:** Produces `budgets`; `categories.bucket`; cálculo de consumo por categoria/bucket; alerta (`insight` `budget_alert`) ao cruzar limiar.

- [ ] **Step 1: Teste (falha primeiro)** — orçamento fixo de R$500 em "Mercado"; gasto R$520 no mês → status `over` e um `budget_alert`. Para 50/30/20: renda R$5.000 → limites needs 2.500 / wants 1.500 / savings 1.000; gasto needs R$2.600 → bucket needs `over`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0019_budgets.sql`:
```sql
create type budget_method as enum ('fixed','50-30-20');
create type bucket as enum ('needs','wants','savings');

alter table categories add column bucket bucket;

create table budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  method budget_method not null,
  category_id uuid references categories(id),   -- usado em 'fixed'
  limit_cents bigint,                            -- usado em 'fixed'
  created_at timestamptz not null default now()
);
alter table budgets enable row level security;
create policy bud_select on budgets for select using (is_member(workspace_id));
create policy bud_cud on budgets for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: Service** — consumo fixo = `month_category_breakdown` (Fase 1) vs `limit_cents`. 50/30/20: renda do mês × {0.5,0.3,0.2} vs soma de despesas por `bucket`. Ao cruzar 80%/100% → `upsert` insight `budget_alert`. Endpoints `GET/POST /budgets`, `GET /budgets/status?month=`.

- [ ] **Step 5: Ver passar e commit** — `git commit -am "feat(budgets): fixed and 50/30/20 budgets with breach alerts"`

---

## Task 8: Metas/cofrinhos + web

**Files:** Create `supabase/migrations/0020_goals.sql`; `apps/api/src/goals/*`; web `views/InsightsView.vue`, `views/BudgetsView.vue`, `views/GoalsView.vue`. Test: `apps/api/test/e2e/goals.e2e.test.ts`.

**Interfaces:** Produces `goals` + `goal_contributions`; `POST /goals`, `POST /goals/:id/contribute`; telas de insights, orçamentos e metas.

- [ ] **Step 1: e2e (falha primeiro)** — cria meta R$10.000; contribui R$2.500 → `saved_cents=250000`; ao atingir o alvo, gera `goal_alert`.

- [ ] **Step 2: Migration** — `goals`(id, workspace_id, name, target_cents, deadline, saved_cents default 0) + `goal_contributions`(id, goal_id, amount_cents, date, created_by) + RLS.

- [ ] **Step 3: Service** — `contribute` incrementa `saved_cents` e registra contribuição; se `saved>=target`, `upsert` `goal_alert`.

- [ ] **Step 4: Ver passar.**

- [ ] **Step 5: Web (verificação manual)** — `InsightsView` (feed com badges por tipo, marcar lido), `BudgetsView` (fixo + toggle 50/30/20 com barras por bucket), `GoalsView` (progresso por meta). Botão "recalcular insights" chama `POST /insights/compute` (enfileira `compute_insights`).

- [ ] **Step 6: Commit** — `git commit -am "feat(goals): goals/contributions and intelligence web screens"`

---

## Self-review (feito)

- **Cobertura:** categorização que aprende (Tasks 1–3) · anomalias/assinaturas (Task 5) · previsão + resumo (Task 6) · orçamentos fixo/50-30-20 + alertas (Task 7) · metas (Task 8) · feed de insights (Task 4).
- **Determinismo:** motor de regras e detectores testados sem rede; LLM só em fallback de categoria e narrativa, mockado.
- **Idempotência:** insights por `dedup_key` — recomputar não duplica; regras por `(match_type,pattern)`.
- **Pontos de atenção:** (a) o CTE de média do `detect_spikes` precisa de ajuste fino no SQL (a versão é ilustrativa da intenção); (b) `bucket` em categorias começa nulo — a UX do 50/30/20 deve guiar o usuário a classificar; (c) limiares (1.5x, 80%/100%, ≥3 meses) ficam configuráveis por env/const pra calibrar sem migration.

---

## Execução

`subagent-driven`. Dependências: 1 → 2 → 3 ; 4 → 5 → 6 ; 7 ; 8. As Tasks 5–6 (SQL de detecção/previsão) são as mais sensíveis — vale review caprichado nelas.

---

> **Próxima:** Fase 5 (Família/PJ) — ativa o convite real (e-mail → aceite), o RBAC efetivo nas operações, troca de workspace e divisão de despesas; e os campos básicos de PJ (centro de custo, separação PF/PJ). É aqui que o `workspaces ... limit(1)` das fases anteriores dá lugar ao `workspace_id` explícito por requisição.
