# Fase 7 — Open Finance (Pluggy) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps em checkbox.
>
> **Convenção:** scaffolding por comandos; código autoral por completo. O agregador (Pluggy) fica atrás de `AggregatorGateway` e é **mockado** nos testes — nenhuma chamada real em CI. Reusa idempotência da Fase 3 (`import_fingerprint`) e fila/serviços anteriores. Repo: `docs/superpowers/plans/2026-06-25-fase-7-open-finance.md`.

**Goal:** Conectar contas bancárias via Open Finance, sincronizar transações automaticamente e **conciliar** com lançamentos manuais/IA sem duplicar. Tudo isolado por workspace, com consentimento explícito (LGPD).

**Architecture:** Usuário autoriza o banco no widget do provedor → provedor cria um *item* e dispara **webhook** → backend enfileira `sync_connection` → worker puxa contas/transações via `AggregatorGateway`, mapeia para o schema, **deduplica por id do provedor** e **concilia** com lançamentos existentes. Provedor isolado atrás de interface (trocável por Belvo).

**Tech Stack:** Pluggy (SDK/HTTP) atrás de `AggregatorGateway`, BullMQ, Supabase (RLS), NestJS, Vue (widget Pluggy Connect).

## Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Provedor | **Pluggy** atrás de `AggregatorGateway` (interface). Belvo como troca futura sem tocar domínio. |
| 2 | Idempotência | Reusa `import_fingerprint` (Fase 3): `of:{providerAccountId}:{providerTxId}`. |
| 3 | Conciliação | Transação do banco que casa com lançamento manual/IA (conta + valor + data ±2d) **vincula** (carimba o fingerprint) em vez de duplicar. |
| 4 | Sincronização | Disparada por **webhook** (item atualizado) + botão manual. Worker faz o pull. |
| 5 | Consentimento | `bank_connections` guarda status/expiração do consentimento; desconectar revoga e para o sync. |
| 6 | Conta | Cada conta do banco vira/linka uma `account` nossa (`bank_account_links`). |

## Global Constraints

- Nenhuma credencial bancária trafega/persiste no nosso backend — fica no provedor; guardamos só o `item_id` e tokens do provedor.
- Webhook valida assinatura antes de agir.
- Migrations continuam (próxima: `0026`).

---

## Task 1: `AggregatorGateway` + implementação Pluggy

**Files:** Create `apps/worker/src/openfinance/aggregator.ts` (interface), `pluggy.ts` (impl). Test: `apps/worker/test/pluggy.test.ts`.

**Interfaces:** Produces `AggregatorGateway`: `connectToken(ctx)`, `listAccounts(itemId)`, `listTransactions(accountId, since)`, `verifyWebhook(headers, body)`. Pluggy implementado via HTTP, mockado em teste.

- [ ] **Step 1: Teste mockado (falha primeiro)** — `fetch` mockado: `listTransactions` retorna 2 itens do formato Pluggy; o gateway normaliza para `{ providerTxId, dateISO, amountCents, description, providerAccountId }` (sinal correto: débito → negativo).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Interface + normalização** — `apps/worker/src/openfinance/aggregator.ts`:
```ts
export type NormalizedTxn = {
  providerTxId: string; providerAccountId: string;
  dateISO: string; amountCents: number; description: string | null;
};
export type NormalizedAccount = {
  providerAccountId: string; name: string; type: string;
};
export interface AggregatorGateway {
  connectToken(opts: { clientUserId: string }): Promise<{ token: string }>;
  listAccounts(itemId: string): Promise<NormalizedAccount[]>;
  listTransactions(providerAccountId: string, sinceISO: string): Promise<NormalizedTxn[]>;
  verifyWebhook(headers: Record<string, string>, rawBody: string): boolean;
}
```
`apps/worker/src/openfinance/pluggy.ts`: implementa via API do Pluggy (auth com `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`), mapeando o payload deles para os tipos normalizados; `amountCents` negativo para débito; `verifyWebhook` confere a assinatura do header conforme a doc do provedor.

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(openfinance): AggregatorGateway interface and Pluggy implementation"`

---

## Task 2: Migrations — conexões, links de conta, campos de provedor

**Files:** Create `supabase/migrations/0026_open_finance.sql`. Test: `apps/api/test/database/open_finance.test.ts`.

**Interfaces:** Produces `bank_connections`, `bank_account_links`; `transactions.source` passa a aceitar `openfinance`; `reconciled_at` em transactions. RLS.

- [ ] **Step 1: Teste (falha primeiro)** — `select` nas novas tabelas/colunas OK; isola por workspace.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0026_open_finance.sql`:
```sql
create type connection_status as enum ('pending','active','error','revoked');

create table bank_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null default 'pluggy',
  provider_item_id text not null,
  status connection_status not null default 'pending',
  consent_expires_at timestamptz,
  last_sync_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_item_id)
);

create table bank_account_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references bank_connections(id) on delete cascade,
  provider_account_id text not null,
  account_id uuid not null references accounts(id) on delete cascade,
  unique (connection_id, provider_account_id)
);

alter table transactions add column reconciled_at timestamptz;

alter table bank_connections enable row level security;
alter table bank_account_links enable row level security;
create policy bc_select on bank_connections for select using (is_member(workspace_id));
create policy bc_cud on bank_connections for all
  using (has_role(workspace_id, array['owner','admin']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin']::member_role[]));
create policy bal_all on bank_account_links for all
  using (exists (select 1 from bank_connections c
    where c.id = connection_id and is_member(c.workspace_id)))
  with check (exists (select 1 from bank_connections c
    where c.id = connection_id and has_role(c.workspace_id, array['owner','admin']::member_role[])));
```
> `transactions.source` é `text` desde a Fase 1, então `'openfinance'` já cabe sem alterar tipo.

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(openfinance): connections, account links and reconciliation column"`

---

## Task 3: Fluxo de conexão (consentimento)

**Files:** Create `apps/api/src/openfinance/openfinance.controller.ts`, `openfinance.service.ts`. Test: `apps/api/test/e2e/openfinance-connect.e2e.test.ts`.

**Interfaces:** Produces `POST /openfinance/connect-token` (token p/ o widget) e `POST /openfinance/items { itemId }` (pós-widget → cria `bank_connection` pending + linka contas). owner/admin.

- [ ] **Step 1: e2e (falha primeiro)** — `connect-token` retorna um token (gateway mockado); `POST /items { itemId }` cria uma `bank_connection` e, via `listAccounts` mockado, cria/linca as `accounts` correspondentes em `bank_account_links`.

- [ ] **Step 2..4: Implementar e ver passar** — service usa `AggregatorGateway`; ao registrar o item, busca contas, cria `accounts` (type mapeado) e `bank_account_links`, marca conexão `active` e `consent_expires_at`.

- [ ] **Step 5: Commit** — `git commit -am "feat(openfinance): connect-token and item registration with account linking"`

---

## Task 4: Sync — pull, dedup, conciliação

**Files:** Create `apps/worker/src/openfinance/sync.processor.ts`. Test: `apps/worker/test/of-sync.test.ts`.

**Interfaces:** Produces job `openfinance.sync` que puxa transações desde `last_sync_at`, deduplica por fingerprint e **concilia** com lançamentos existentes. Reusa o índice único da Fase 3.

- [ ] **Step 1: Teste mockado (falha primeiro)** — `of-sync.test.ts`:
  - `listTransactions` mockado retorna 3 itens; processa → 3 transações `source='openfinance'`.
  - **idempotência:** reprocessar os mesmos 3 → 0 novos.
  - **conciliação:** existe um lançamento manual (mesma conta, R$50, data ±1d) sem fingerprint; ao sincronizar a transação do banco equivalente, o **manual** recebe o fingerprint + `reconciled_at`, e **nenhuma** transação nova é criada para esse item.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Processor** — `apps/worker/src/openfinance/sync.processor.ts` (núcleo):
```ts
// para cada transação normalizada do provedor:
const fp = `of:${n.providerAccountId}:${n.providerTxId}`;
// 1) já existe esse fingerprint? -> pula (idempotência)
const exists = await sb.from("transactions").select("id").eq("import_fingerprint", fp).maybeSingle();
if (exists.data) continue;

// 2) conciliação: casa com manual/IA não conciliado?
const lo = addDays(n.dateISO, -2), hi = addDays(n.dateISO, 2);
const match = await sb.from("transactions").select("id")
  .eq("account_id", accountId)
  .eq("amount_cents", Math.abs(n.amountCents))
  .gte("date", lo).lte("date", hi)
  .is("import_fingerprint", null)
  .in("source", ["manual","ai"]).limit(1).maybeSingle();

if (match.data) {
  await sb.from("transactions").update({ import_fingerprint: fp, reconciled_at: new Date().toISOString() })
    .eq("id", match.data.id);     // vincula, não duplica
} else {
  await sb.from("transactions").insert({
    workspace_id, account_id: accountId,
    type: n.amountCents < 0 ? "expense" : "income",
    amount_cents: Math.abs(n.amountCents), date: n.dateISO,
    description: n.description, source: "openfinance",
    import_fingerprint: fp, created_by: connectionOwnerId,
  });
}
```
Ao fim, atualizar `bank_connections.last_sync_at`.

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(openfinance): sync with dedup and reconciliation against manual/AI entries"`

---

## Task 5: Webhook + desconectar

**Files:** Create `apps/api/src/openfinance/webhook.controller.ts`; endpoint `DELETE /openfinance/connections/:id`. Test: `apps/api/test/e2e/openfinance-webhook.e2e.test.ts`.

**Interfaces:** Produces `POST /openfinance/webhook` (valida assinatura → enfileira `openfinance.sync`); `DELETE` revoga consentimento e para o sync.

- [ ] **Step 1: e2e (falha primeiro)** — webhook com assinatura inválida → 401, nada enfileirado; assinatura válida (gateway mockado) → enfileira sync da conexão certa. `DELETE` marca `status='revoked'`.

- [ ] **Step 2..4: Implementar e ver passar** — webhook é rota **sem** auth de usuário (vem do provedor), por isso a assinatura é a defesa; resolve a conexão pelo `item_id` do payload e enfileira. `DELETE` exige owner/admin.

- [ ] **Step 5: Commit** — `git commit -am "feat(openfinance): signed webhook → sync, and consent revocation"`

---

## Task 6: Web — conectar, conexões, conciliação

**Files:** Create `apps/web/src/views/ConnectionsView.vue`, `components/ReconcileBadge.vue`. Test: `apps/web/src/components/__tests__/reconcile.test.ts`.

**Interfaces:** Consumes endpoints das Tasks 3/5. Produces: botão "Conectar banco" (abre o Pluggy Connect com o token), lista de conexões com status/última sincronização, botão "Sincronizar agora", e marcação visual de transações conciliadas na listagem.

- [ ] **Step 1: Teste (falha primeiro)** — `ReconcileBadge` mostra "conciliado" quando `reconciled_at` presente, "banco" quando `source='openfinance'`, e nada para manual puro.

- [ ] **Step 2..4: Implementar e ver passar** — integra o widget do provedor (script do Pluggy Connect), trata o callback com o `itemId` → `POST /openfinance/items`. Tela de conexões com ações.

- [ ] **Step 5: Commit** — `git commit -am "feat(web): bank connection flow, connections list and reconciliation badges"`

---

## Self-review (feito)

- **Cobertura:** gateway/Pluggy (Task 1), schema (Task 2), conexão/consentimento (Task 3), sync+dedup+conciliação (Task 4), webhook+revogação (Task 5), web (Task 6).
- **Isolamento de provedor:** tudo via `AggregatorGateway` → Belvo entra como nova impl sem tocar sync/domínio.
- **Idempotência e conciliação** reusam a infra da Fase 3; saldo/dashboard recalculam sozinhos.
- **Segurança/LGPD:** credenciais bancárias nunca tocam nosso backend; consentimento e expiração registrados; revogação para o sync; webhook autenticado por assinatura.
- **Pontos de atenção (exigem conta no provedor, não cobertos por teste):** (a) chaves `PLUGGY_CLIENT_ID/SECRET` e o formato real de assinatura do webhook; (b) o widget Pluggy Connect roda no front e seu callback precisa de URL pública em produção; (c) política de sandbox vs produção do provedor; (d) janelas de conciliação (±2d, igualdade de valor) são heurísticas — calibrar e permitir "desfazer conciliação" na UI.

---

## Execução

`subagent-driven`. Dependências: 1 → 2 → 3 → 4 → 5 → 6. A **Task 4 (sync/conciliação)** é o coração e carrega o DoD de não-duplicação; review caprichado nela.

---

> **Próxima (última):** Fase 8 (PWA & engajamento) — offline-first, push notifications (lembrete de contas a pagar, alerta de orçamento), atalhos de lançamento (compartilhar foto direto pro app), exportação/backup e polimento mobile. Encerra o roadmap.
