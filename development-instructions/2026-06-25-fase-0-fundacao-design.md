# Fase 0 — Fundação · Design Spec

> No seu repositório, este arquivo vive em `docs/superpowers/specs/2026-06-25-fase-0-fundacao-design.md` (convenção Superpowers). Próximo passo após aprovação: `writing-plans`.

**Data:** 2026-06-25
**Status:** aprovado para virar plano de implementação

---

## 1. Objetivo

Levantar o esqueleto do SaaS multiusuário de finanças com **isolamento multi-tenant comprovado**, sem ainda lançar dinheiro (contas e transações são Fase 1). É a fundação sobre a qual todas as fases seguintes se apoiam.

## 2. Critério de pronto (Definition of Done)

1. Usuário faz **signup** → um workspace `personal` é criado automaticamente, com o usuário como `owner`.
2. **Login** funciona (e-mail/senha).
3. **Teste automatizado** prova que um usuário não acessa dados de um workspace do qual não é membro (isolamento RLS).
4. **Worker** sobe e processa um job de health no-op.
5. **CI verde:** lint + type-check + testes + migrations aplicam em banco limpo.

## 3. Convenções globais (constraints de todo o projeto)

Definidas agora, valem para todas as fases:

- **Dinheiro:** inteiro em menor unidade (centavos) + código de moeda ISO 4217. Nunca float.
- **Ledger:** quase-double-entry. Receita/despesa movimenta **uma** conta e tem categoria. Transferência carrega `account_origem` + `account_destino` e **não** tem categoria. Schema preparado para evoluir a partida dobrada plena sem migração de dados destrutiva.
- **Moeda:** definida **por workspace** na criação (default `BRL`). Todas as contas/transações do workspace herdam essa moeda. Sem motor de câmbio na v1.
- **Tipagem:** TypeScript ponta a ponta; schemas Zod compartilhados entre front e back via `packages/shared`.
- **Multi-tenant:** toda tabela com dados de usuário carrega `workspace_id` e é protegida por RLS.

## 4. Arquitetura — estrutura do monorepo

pnpm + Turborepo.

```
apps/
  web/      → Vue 3 + Vite (PWA), Pinia, Vue Router, i18n pt-BR
  api/      → NestJS (adapter Fastify)
  worker/   → BullMQ workers
packages/
  shared/   → tipos + schemas Zod compartilhados (DTOs, enums)
  config/   → ESLint/TS/tsconfig base compartilhados
```

Infra de dados: **Supabase** (Postgres + Auth + Storage + RLS). **Redis** para fila (BullMQ). Deploy-alvo: web → Vercel; api/worker/redis → Railway (não faz parte do DoD da Fase 0, mas a estrutura não deve impedir).

## 5. Modelo de dados da fundação

Apenas o necessário para a fundação. `User` é gerenciado pelo Supabase Auth (`auth.users`).

### `workspaces`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| type | enum `workspace_type` | `personal` \| `family` \| `business` |
| name | text | não nulo |
| currency | char(3) | ISO 4217, default `BRL`, imutável após criação |
| created_by | uuid | FK `auth.users(id)` |
| created_at | timestamptz | default `now()` |
| updated_at | timestamptz | default `now()` |

### `workspace_members`
| Coluna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid | FK `workspaces(id)` ON DELETE CASCADE |
| user_id | uuid | FK `auth.users(id)` ON DELETE CASCADE |
| role | enum `member_role` | `owner` \| `admin` \| `member` \| `viewer` |
| created_at | timestamptz | default `now()` |
| | | **UNIQUE (workspace_id, user_id)** |

Índices: `workspace_members(user_id)`, `workspace_members(workspace_id)`.

## 6. Auth & onboarding

- Supabase Auth, **e-mail/senha** na v1.
- No signup, uma function **`handle_new_user()`** disparada por trigger `AFTER INSERT ON auth.users` cria **atomicamente**: (a) um `workspace` (`type='personal'`, `name='Pessoal'`, `currency='BRL'`, `created_by = NEW.id`) e (b) um `workspace_member` (`role='owner'`). Function como `SECURITY DEFINER`.
- **Decisão registrada (default aprovado):** criação do workspace no **banco (trigger)**, não no app — garante atomicidade e funciona mesmo se o signup vier por outro caminho.
- **Deferido:** login social (Google) e 2FA → fase de segurança (8).

## 7. Isolamento — RLS

RLS habilitado em `workspaces` e `workspace_members`.

- **Helper `is_member(target_workspace uuid) returns boolean`** como `SECURITY DEFINER` (consulta `workspace_members` por `auth.uid()`). Usar a function nas policies evita **recursão infinita** de RLS quando uma policy de `workspace_members` referencia a própria tabela — esse é o gotcha clássico do Supabase e a função contorna.
- `workspaces`:
  - SELECT: `is_member(id)`.
  - INSERT: usuário autenticado, com `created_by = auth.uid()`.
  - UPDATE/DELETE: membro com papel `owner`/`admin`.
- `workspace_members`:
  - SELECT: `is_member(workspace_id)` (vejo os membros dos workspaces a que pertenço).
  - INSERT/DELETE: restrito a `owner`/`admin` do workspace (na prática, na Fase 0 só o trigger insere; a UX de convite é Fase 5).

RLS é **defesa em profundidade**, somada às checagens de autorização no NestJS.

## 8. Esqueleto de fila

Redis + BullMQ. Uma fila (`system`) com um job **`health.noop`** que o `apps/worker` consome e marca como completo. Serve só para provar a fiação ponta a ponta (enfileirar na api → processar no worker). A lógica de IA entra na Fase 2.

## 9. Transversais

- **i18n** pt-BR como base (estrutura de chaves pronta para novas línguas).
- **Design system** base: tokens (cores, tipografia, espaçamento) + um punhado de componentes mínimos (Button, Input, Card). Sem telas de produto ainda.
- **CI:** pipeline com lint, type-check, testes e aplicação de migrations em banco efêmero.

## 10. Cenários de teste (alimentam o writing-plans)

- **T1 — Trigger de onboarding:** ao criar um usuário, existe exatamente 1 workspace `personal` e 1 membership `owner` para ele.
- **T2 — Isolamento (leitura):** usuário A não consegue SELECT em workspace de B.
- **T3 — Isolamento (escrita):** usuário A não insere `workspace_member` em workspace que não administra.
- **T4 — Recursão RLS:** consultar `workspace_members` do próprio workspace não estoura recursão.
- **T5 — Fila:** `health.noop` é enfileirado e processado com sucesso.
- **T6 — CI:** lint + type-check + testes + migrations rodam limpos do zero.

## 11. Fora de escopo da Fase 0

Contas e transações (Fase 1) · categorias e seed BR (Fase 1) · ingestão por IA (Fase 2) · import de arquivos (Fase 3) · insights/orçamentos (Fase 4) · convite real e PJ/família ativos (Fase 5) · chat (Fase 6) · Open Finance (Fase 7) · PWA offline/push, social login, 2FA (Fase 8).

## 12. Decisões registradas

| Tema | Decisão |
|---|---|
| Ledger | Quase-double-entry (transferência com origem/destino) |
| Moeda | Por workspace, default BRL, sem câmbio |
| Multiusuário na Fase 0 | Só modelo + RLS + workspace pessoal automático; convite real na Fase 5 |
| Auth v1 | E-mail/senha; social e 2FA deferidos |
| Criação do workspace | Trigger no banco (`SECURITY DEFINER`), não no app |
