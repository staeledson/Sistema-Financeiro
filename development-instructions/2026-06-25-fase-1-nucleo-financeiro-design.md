# Fase 1 — Núcleo Financeiro (MVP manual) · Design Spec

> Repo: `docs/superpowers/specs/2026-06-25-fase-1-nucleo-financeiro-design.md`. Próximo passo: `writing-plans` (já incluído no plano que acompanha este spec).

**Data:** 2026-06-25
**Depende de:** Fase 0 (workspaces, workspace_members, RLS, `is_member`/`has_role`, trigger de onboarding).

---

## 1. Objetivo

Tornar o workspace pessoal usável de verdade: criar contas, lançar receita/despesa/transferência manualmente, listar com filtros e ver um dashboard básico.

## 2. Critério de pronto (DoD)

1. Sequência roteirizada de lançamentos → **saldos batem exatamente** (por conta e consolidado).
2. Transferências **não** contam como gasto nos relatórios/dashboard.
3. Dashboard exibe 4 widgets: saldo consolidado, receita×despesa do mês, top categorias do mês, evolução (N meses).
4. Listagem filtra por período, conta, categoria e busca textual.
5. Toda tabela nova isola por `workspace_id` via RLS (testado).

## 3. Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Saldo | **Derivado on-read** via view SQL `account_balances` com `security_invoker=true`. Sem coluna cacheada. |
| 2 | Categorias | **Seed BR por workspace, editável.** Semeadas por trigger `after insert on workspaces`. |
| 3 | Transferência | **Linha única** com `source_account_id` + `dest_account_id`. Tabela de `entries` (partida dobrada plena) fica para evolução futura. |
| 4 | Cartão de crédito | **Conta normal** (saldo pode ficar negativo). Ciclo de fatura/competência adiado para junto do import (Fase 3). |
| 5 | Exclusão de conta | **Arquivar** (soft, flag `archived`), nunca apagar com histórico. |

## 4. Convenções herdadas (Fase 0)

Dinheiro em **centavos (inteiro)**; moeda **por workspace**, herdada por contas/transações; ledger **quase-double-entry**; RLS por `workspace_id` com `is_member`/`has_role`.

## 5. Modelo de dados

### `accounts`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK→workspaces | ON DELETE CASCADE |
| type | enum `account_type` | `checking`/`savings`/`credit_card`/`cash`/`investment` |
| name | text not null | |
| opening_balance_cents | bigint not null default 0 | pode ser negativo |
| archived | boolean not null default false | exclusão = arquivar |
| created_at | timestamptz default now() | |

### `categories`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK→workspaces | |
| type | enum `category_type` | `income`/`expense` |
| parent_id | uuid FK→categories null | hierarquia suportada (seed é flat) |
| name | text not null | |
| icon | text null | |
| color | text null | |
| is_system | boolean default false | marca as semeadas |

### `tags` / `transaction_tags`
`tags`(id, workspace_id, name; unique(workspace_id,name)). `transaction_tags`(transaction_id, tag_id; PK composto). Relação N:N.

### `transactions`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK→workspaces | |
| type | enum `transaction_type` | `income`/`expense`/`transfer` |
| amount_cents | bigint not null | **> 0** (CHECK) |
| date | date not null | |
| account_id | uuid FK→accounts null | obrigatório em income/expense; null em transfer |
| source_account_id | uuid FK→accounts null | obrigatório em transfer |
| dest_account_id | uuid FK→accounts null | obrigatório em transfer |
| category_id | uuid FK→categories null | em income/expense; **null** em transfer |
| description | text null | |
| counterparty | text null | |
| source | text not null default 'manual' | origem do lançamento |
| created_by | uuid FK→auth.users | |
| created_at | timestamptz default now() | |

**Constraints de forma (CHECK):**
```
amount_cents > 0
(type in ('income','expense') AND account_id is not null
   AND source_account_id is null AND dest_account_id is null)
OR
(type = 'transfer' AND account_id is null AND category_id is null
   AND source_account_id is not null AND dest_account_id is not null
   AND source_account_id <> dest_account_id)
```
**Validações em app (não no DB):** conta(s) pertencem ao mesmo workspace; `category.type` casa com o `transaction.type` (categoria de despesa só em despesa).

## 6. Seed de categorias BR

Function `seed_default_categories(p_workspace uuid)` (`security definer`, pois roda no trigger antes da membership existir) chamada por trigger `after insert on workspaces`. Seed **flat** (hierarquia fica para o usuário criar):

- **Receita (5):** Salário, Freelance, Investimentos, Reembolso, Outras receitas.
- **Despesa (15):** Moradia, Contas e utilidades, Supermercado, Restaurantes e delivery, Transporte, Combustível, Saúde, Farmácia, Educação, Lazer, Compras, Assinaturas, Impostos e taxas, Pets, Outras despesas.

Todas com `is_system=true`; o usuário pode editar/excluir/criar.

## 7. Cálculo de saldo (derivado)

View `account_balances` (`security_invoker=true`, para que a RLS do chamador valha):
```
saldo_conta = opening_balance_cents
  + Σ income  com account_id = conta        (+)
  + Σ expense com account_id = conta        (−)
  + Σ transfer com dest_account_id = conta  (+)
  + Σ transfer com source_account_id = conta(−)
```
Saldo consolidado do workspace = soma de `balance_cents` das contas não arquivadas (moeda única ⇒ somável direto).

## 8. Dashboard (escopo enxuto)

Quatro widgets, alimentados por RPCs SQL (`security invoker`, guardadas por `is_member`):
- **Saldo consolidado** → soma da view.
- **Receita × despesa do mês** → RPC `month_cashflow(workspace, month)` — **exclui transferências**.
- **Top categorias do mês** → RPC `month_category_breakdown(workspace, month, type)`.
- **Evolução** → RPC `cashflow_series(workspace, n_months)`.

## 9. RLS (padrão das tabelas novas)

Em `accounts`, `categories`, `tags`, `transaction_tags`, `transactions`: RLS habilitado; SELECT via `is_member(workspace_id)`; INSERT/UPDATE/DELETE via `has_role(workspace_id, {owner,admin,member})` (viewer é read-only). `transaction_tags` herda o escopo via join com a transação.

## 10. Cenários de teste

- **A1** conta criada aparece na listagem; arquivar a remove da lista ativa.
- **C1** novo workspace já vem com 5 receitas + 15 despesas semeadas.
- **C2** CRUD de categoria respeita RLS.
- **TX1** income/expense/transfer válidos inserem.
- **TX2** rejeita: transfer com categoria; income sem conta; transfer com origem=destino; amount ≤ 0.
- **TX3** listagem filtra por período/conta/categoria/busca.
- **BAL1 (crítico)** sequência roteirizada → saldo por conta e consolidado batem; transferência move saldo entre contas sem virar gasto.
- **BAL2** saldo não soma contas de outro workspace (RLS na view).
- **DASH1** receita×despesa do mês exclui transferências.
- **DASH2** top categorias do mês corretas.
- **DASH3** série de evolução dos últimos N meses correta.
- **ISO** isolamento RLS em todas as tabelas novas.

## 11. Fora de escopo da Fase 1

Recorrências/contas a pagar, orçamentos (50/30/20) e metas → **Fase 4**. IA → **Fase 2**. Import e ciclo de fatura de cartão → **Fase 3**. Colaboração/convite → **Fase 5**.

## 12. Decomposição (8 tasks)

1. `@app/shared` — enums + Zod (account/category/tag/transaction).
2. `accounts` — migration + RLS + CRUD + arquivar.
3. `categories` — migration + seed BR + trigger + CRUD.
4. `tags` + `transaction_tags` — migration + RLS + API.
5. `transactions` — migration (CHECK de forma) + validações de app + create/list com filtros.
6. **`account_balances`** view + consolidado + testes "saldos batem" (crítica).
7. Dashboard — RPCs + testes (transfer fora do gasto).
8. Web — contas, form de lançamento rápido (3 tipos), listagem com filtros, dashboard.
