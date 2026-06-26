# Fase 8 — PWA & Engajamento · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps em checkbox.
>
> **Convenção:** scaffolding por comandos; código autoral por completo. Push/web-push mockados em teste. Reusa fila, insights (Fase 4) e ingestão por IA (Fase 2). Repo: `docs/superpowers/plans/2026-06-25-fase-8-pwa.md`.

**Goal:** Tornar o app instalável e retentivo: offline-first (leitura + fila de escrita), push (lembrete de contas, alerta de orçamento), atalho de lançamento por compartilhamento de foto, contas a pagar/lembretes e exportação/backup.

**Architecture:** Service worker (Workbox via vite-plugin-pwa) cacheia o app shell e dados de leitura (IndexedDB); escritas offline vão pra uma fila local replayada ao reconectar. Push via Web Push (VAPID): assinaturas persistidas; jobs agendados varrem contas a vencer e orçamentos estourados e disparam notificação. `share_target` no manifesto envia foto pro fluxo de IA da Fase 2.

**Tech Stack:** vite-plugin-pwa/Workbox, IndexedDB (idb), Web Push (`web-push` + VAPID), BullMQ (jobs agendados), NestJS, Vue.

## Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Push | **Web Push (VAPID)** + service worker. Assinaturas em `push_subscriptions`. |
| 2 | Offline | **Read-first** (cache de saldos/transações recentes em IndexedDB) + **fila de lançamentos** replayada ao reconectar. |
| 3 | Atalho | `share_target` no manifesto → foto compartilhada cai no **ingest por IA** (Fase 2). |
| 4 | Contas a pagar | `scheduled_bills` (consolida a lacuna de recorrência) alimenta os lembretes. |
| 5 | Export | CSV e XLSX das transações + **backup JSON** do workspace. |
| 6 | Gatilho dos jobs | Jobs **repeatable** (BullMQ) diários + botão manual. |

## Global Constraints

- Lógica de elegibilidade de lembrete/alerta é **pura e testável**; envio (web-push) atrás de gateway mockado.
- Push só com consentimento do usuário (permissão do browser).
- Migrations continuam (próxima: `0027`).

---

## Task 1: Shell PWA (manifesto + service worker + install)

**Files:** Modify `apps/web/vite.config.ts`, `apps/web/index.html`; Create `apps/web/src/pwa/install.ts`. Test: `apps/web/test/manifest.test.ts`.

**Interfaces:** Produces app instalável (manifesto válido + SW de precache do shell) e prompt de instalação.

- [ ] **Step 1: Teste (falha primeiro)** — após `vite build`, existe `manifest.webmanifest` com `name`, `icons`, `start_url`, `display:standalone` e `share_target`; e um service worker gerado.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Config PWA** — em `vite.config.ts`, `VitePWA` com `registerType:'autoUpdate'`, `manifest` (nome, ícones, tema, `display:'standalone'`, `share_target` apontando para `/lancar/compartilhado` via POST multipart com a imagem) e `workbox` (precache do shell + runtime cache de GET de leitura). `install.ts` captura `beforeinstallprompt` e expõe um `promptInstall()`.

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(pwa): installable manifest, service worker shell and install prompt"`

---

## Task 2: Leitura offline (cache IndexedDB)

**Files:** Create `apps/web/src/offline/cache.ts`, `apps/web/src/offline/useOfflineData.ts`. Test: `apps/web/src/offline/__tests__/cache.test.ts`.

**Interfaces:** Produces cache de saldos/transações recentes; ao ficar offline, dashboard e listagem leem do cache.

- [ ] **Step 1: Teste (falha primeiro)** — `cache.put('balances', data)` e `cache.get('balances')` round-trip; com `navigator.onLine=false`, `useOfflineData` retorna o último cacheado em vez de chamar a API.

- [ ] **Step 2..4: Implementar e ver passar** — `cache.ts` (wrapper sobre `idb`); `useOfflineData` tenta a rede, faz fallback ao cache offline, e atualiza o cache nas respostas online.

- [ ] **Step 5: Commit** — `git commit -am "feat(pwa): offline read cache for balances and recent transactions"`

---

## Task 3: Fila de escrita offline

**Files:** Create `apps/web/src/offline/write-queue.ts`. Test: `apps/web/src/offline/__tests__/write-queue.test.ts`.

**Interfaces:** Produces fila local de lançamentos criados offline, replayada ao reconectar (em ordem, idempotente por id local).

- [ ] **Step 1: Teste (falha primeiro)** — criar 2 lançamentos offline enfileira ambos; ao disparar `flush()` (online, API mockada), os 2 são enviados na ordem e a fila esvazia; falha de rede mantém na fila.

- [ ] **Step 2..4: Implementar e ver passar** — fila em IndexedDB; cada item tem `clientId` (idempotência); `flush()` envia em ordem e remove os confirmados; listener de `online` chama `flush()`.

- [ ] **Step 5: Commit** — `git commit -am "feat(pwa): offline write queue with replay on reconnect"`

---

## Task 4: Push (VAPID) — assinatura e envio

**Files:** Create `supabase/migrations/0027_push.sql`; `apps/api/src/push/*`; `apps/worker/src/push/push.gateway.ts`. Test: `apps/api/test/e2e/push-subscribe.e2e.test.ts`, `apps/worker/test/push-send.test.ts`.

**Interfaces:** Produces `push_subscriptions`; `POST /push/subscribe`; `PushGateway.send(sub, payload)` (web-push, mockado). Consumido pelos lembretes (Task 5).

- [ ] **Step 1: Testes (falham primeiro)** — `subscribe` persiste a assinatura do browser para o usuário/workspace; `PushGateway.send` chama `webpush.sendNotification` (mock) com o payload.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0027_push.sql`:
```sql
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (endpoint)
);
alter table push_subscriptions enable row level security;
create policy ps_all on push_subscriptions for all
  using (is_member(workspace_id)) with check (is_member(workspace_id));
```

- [ ] **Step 4: Gateway** — `push.gateway.ts` usa `web-push` com `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`; `send(sub, payload)`. Endpoint `POST /push/subscribe` grava a assinatura. SW exibe a notificação no evento `push`.

- [ ] **Step 5: Ver passar e commit** — `git commit -am "feat(push): VAPID subscriptions and send gateway"`

---

## Task 5: Contas a pagar + lembretes

**Files:** Create `supabase/migrations/0028_scheduled_bills.sql`; `apps/api/src/bills/*`; `apps/worker/src/reminders/reminders.processor.ts`. Test: `apps/api/test/database/bills.test.ts`, `apps/worker/test/reminders.test.ts`.

**Interfaces:** Produces `scheduled_bills`; job diário `reminders` que seleciona contas a vencer (e orçamentos estourados, reusando Fase 4) → cria `insight` + push.

- [ ] **Step 1: Testes (falham primeiro)** — `bills`: cria conta a pagar com vencimento amanhã; a função pura `dueBills(bills, today, windowDays=3)` a retorna; vencimento daqui a 10 dias → fora. `reminders`: para uma conta a vencer, o processor gera 1 `insight` e chama `PushGateway.send` (mock).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0028_scheduled_bills.sql`:
```sql
create type recurrence as enum ('once','monthly','weekly','yearly');

create table scheduled_bills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  amount_cents bigint not null check (amount_cents > 0),
  due_date date not null,
  recurrence recurrence not null default 'monthly',
  category_id uuid references categories(id),
  account_id uuid references accounts(id),
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table scheduled_bills enable row level security;
create policy sb_select on scheduled_bills for select using (is_member(workspace_id));
create policy sb_cud on scheduled_bills for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: Lógica pura + processor** — `dueBills()` (pura, testável) decide elegibilidade pela janela; `reminders.processor` varre workspaces, materializa `insight` (`type` reusa `budget_alert`/novo) e envia push às assinaturas do workspace. Registrar como job **repeatable** diário. Endpoints `GET/POST /bills`.

- [ ] **Step 5: Ver passar e commit** — `git commit -am "feat(bills): scheduled bills and daily reminder job with push"`

---

## Task 6: Exportação & backup

**Files:** Create `apps/api/src/export/*`. Test: `apps/api/test/e2e/export.e2e.test.ts`.

**Interfaces:** Produces `GET /export/transactions.csv`, `.xlsx` e `GET /export/backup.json` (workspace inteiro), todos escopados por RLS.

- [ ] **Step 1: e2e (falha primeiro)** — `transactions.csv` retorna cabeçalho + N linhas das transações do workspace; `backup.json` inclui contas, categorias, transações, orçamentos e metas.

- [ ] **Step 2..4: Implementar e ver passar** — CSV via serialização simples; XLSX via SheetJS; `backup.json` agrega as tabelas do workspace (somente leitura via token do usuário → RLS garante escopo).

- [ ] **Step 5: Commit** — `git commit -am "feat(export): CSV/XLSX export and JSON workspace backup"`

---

## Task 7: Share target + polimento mobile

**Files:** Create `apps/web/src/views/SharedEntryView.vue`; Modify navegação. Test: `apps/web/src/views/__tests__/shared-entry.test.ts`.

**Interfaces:** Produces a rota `/lancar/compartilhado` que recebe a imagem do `share_target` e a manda pro ingest por IA (Fase 2); bottom-nav mobile, estados de loading/empty e instalação.

- [ ] **Step 1: Teste (falha primeiro)** — `SharedEntryView`, ao receber um `File` (imagem), faz upload ao bucket `receipts` e chama `POST /ingest/image`, redirecionando para a revisão.

- [ ] **Step 2..4: Implementar e ver passar** — handler do share target; bottom-nav (Início, Lançar, Insights, Chat, Mais); revisão de estados mobile; CTA de instalação (Task 1).

- [ ] **Step 5: Commit** — `git commit -am "feat(pwa): share-target quick entry and mobile navigation polish"`

---

## Self-review (feito)

- **Cobertura:** shell instalável (Task 1), leitura offline (Task 2), escrita offline (Task 3), push (Task 4), contas a pagar/lembretes (Task 5), export/backup (Task 6), share target + polimento (Task 7).
- **Lacuna fechada:** `scheduled_bills` consolida as "contas a pagar/recorrência" que ficaram pendentes — agora há substrato real para os lembretes.
- **Testabilidade:** elegibilidade de lembrete e fila offline são puras; web-push atrás de gateway mockado.
- **Pontos de atenção:** (a) chaves VAPID (`VAPID_PUBLIC_KEY/PRIVATE_KEY`) e ícones do PWA precisam ser providos; (b) Web Push tem suporte e comportamento distintos por plataforma (iOS exige app instalado via "Adicionar à Tela de Início"); (c) auto-postagem de transação a partir da conta a pagar (não só lembrar) fica como extensão simples sobre `scheduled_bills`.

---

## Execução

`subagent-driven`. Dependências: 1 → (2,3) ; 4 → 5 ; 6 ; 7. Tasks 2/3 (offline) e 5 (lembretes) concentram a lógica pura testável.

---

## Roadmap concluído

Com a Fase 8, os **9 planos de implementação** estão completos (Fases 0–8). Visão do todo:

| Fase | Entrega | Plano |
|---|---|---|
| 0 | Fundação (monorepo, auth, workspaces, RLS) | ✅ |
| 1 | Núcleo financeiro (contas, lançamentos, saldo, dashboard) | ✅ |
| 2 | Ingestão por IA (foto/voz/texto → rascunho → revisão) | ✅ |
| 3 | Import (CSV/OFX/fatura) com idempotência | ✅ |
| 4 | Inteligência (categorização que aprende, anomalias, previsão, orçamentos, metas) | ✅ |
| 5 | Família & PJ (convite, RBAC, divisão) | ✅ |
| 6 | Chat com function calling e guardrails | ✅ |
| 7 | Open Finance (Pluggy, conciliação) | ✅ |
| 8 | PWA & engajamento (offline, push, lembretes, export) | ✅ |

**Próximo passo de execução:** levar os planos pro Claude Code e rodar **fase a fase** via `subagent-driven-development`, começando pela Fase 0. Decisão ainda em aberto (não bloqueia a Fase 0): **monetização** — você parqueou; ela só importa a partir do momento de definir limites de IA por plano (toca billing, não o núcleo).
