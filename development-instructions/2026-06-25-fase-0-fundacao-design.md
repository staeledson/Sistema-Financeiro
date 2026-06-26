# Fase 0 — Fundação · Design Spec

> No seu repositório, este arquivo vive em `docs/superpowers/specs/2026-06-25-fase-0-fundacao-design.md`.

**Data:** 2026-06-25  
**Revisado:** 2026-06-26 — troca de Supabase por PostgreSQL + Better Auth + MinIO  
**Status:** aprovado para virar plano de implementação

---

## 1. Objetivo

Levantar o esqueleto do SaaS multiusuário de finanças com **isolamento multi-tenant comprovado**, sem ainda lançar dinheiro (contas e transações são Fase 1). É a fundação sobre a qual todas as fases seguintes se apoiam.

## 2. Critério de pronto (Definition of Done)

1. Usuário faz **signup** → um workspace `personal` é criado automaticamente, com o usuário como `owner`.
2. **Login** funciona (e-mail/senha), retorna JWT.
3. **Teste automatizado** prova que um usuário não acessa workspace do qual não é membro (isolamento na camada de aplicação).
4. **Worker** sobe e processa um job de health no-op.
5. **CI verde:** lint + type-check + testes + migrations rodam em banco limpo.

## 3. Convenções globais (constraints de todo o projeto)

Valem para todas as fases:

- **Dinheiro:** inteiro em menor unidade (centavos) + código de moeda ISO 4217. Nunca float.
- **Ledger:** quase-double-entry. Receita/despesa movimenta uma conta e tem categoria. Transferência carrega `account_origem` + `account_destino` e não tem categoria.
- **Moeda:** definida por workspace na criação (default `BRL`). Imutável após criação. Sem motor de câmbio na v1.
- **Tipagem:** TypeScript ponta a ponta; schemas Zod compartilhados em `packages/shared`.
- **Multi-tenant:** toda tabela com dados de usuário carrega `workspace_id` e é filtrada por membership na camada de aplicação.

## 4. Stack da fundação

| Camada | Escolha |
|---|---|
| Banco | **PostgreSQL 16** via Docker Compose (local) / Railway (prod) |
| ORM + migrations | **Prisma** |
| Auth | **Better Auth** (`better-auth`) — email/senha, sessions/JWT |
| Storage (comprovantes) | **MinIO** local / S3-compatível em prod — entra na **Fase 2** |
| Fila | Redis + **BullMQ** |
| API | NestJS + Fastify |
| Frontend | Vue 3 + Vite PWA |
| Isolamento multi-tenant | **Camada de aplicação**: NestJS guards + filtros Prisma (não RLS nativo) |

> **Por que sem RLS nativo?** O PostgreSQL RLS via JWT exigia o Supabase para propagar `auth.uid()` automaticamente. Sem esse middleware, o isolamento é feito nos services NestJS via `workspace_members` — menos "magia", mais legível. A defesa em profundidade pode ser adicionada depois com `SET LOCAL app.current_user_id` em um middleware Prisma.

## 5. Arquitetura — estrutura do monorepo

```
apps/
  web/      → Vue 3 + Vite (PWA), Pinia, Vue Router, i18n pt-BR
  api/      → NestJS (adapter Fastify) + Prisma + Better Auth
  worker/   → BullMQ workers
packages/
  shared/   → tipos + schemas Zod compartilhados
  config/   → ESLint/TS/tsconfig base
```

## 6. Modelo de dados

Better Auth gerencia as tabelas `user`, `session`, `account`, `verification` via Prisma adapter. O app adiciona:

### `workspaces`
| Coluna | Tipo | Notas |
|---|---|---|
| id | String (cuid) PK | gerado pelo Prisma |
| type | Enum `WorkspaceType` | `personal` \| `family` \| `business` |
| name | String | não nulo |
| currency | String(3) | ISO 4217, default `BRL` |
| createdById | String | FK `user.id` |
| createdAt | DateTime | default now |
| updatedAt | DateTime | auto-update |

### `workspace_members`
| Coluna | Tipo | Notas |
|---|---|---|
| id | String (cuid) PK | |
| workspaceId | String | FK `workspaces.id` ON DELETE CASCADE |
| userId | String | FK `user.id` ON DELETE CASCADE |
| role | Enum `MemberRole` | `owner` \| `admin` \| `member` \| `viewer` |
| createdAt | DateTime | default now |
| | | **@@unique([workspaceId, userId])** |

## 7. Auth & onboarding

- **Better Auth** com provider `emailPassword`.
- Na hook `after.signUp`: cria **atomicamente** (em Prisma transaction) um workspace `personal` + membership `owner`.
- JWT retornado como `Bearer` token. API extrai e valida via `auth.api.getSession()`.
- Sessão persistida em cookie httpOnly (Better Auth) ou header `Authorization` (API client).

## 8. Isolamento multi-tenant (sem RLS)

Padrão em todos os módulos de domínio:

1. **`CurrentUserGuard`** (NestJS): valida JWT/sessão Better Auth, injeta `req.user` (`{ id, email }`).
2. **`WorkspaceMember` lookup** no service: antes de servir dados, verifica `workspace_members` pelo `(workspaceId, userId)` — se não existir, lança `ForbiddenException`.
3. Todas as queries Prisma de domínio incluem `where: { workspaceId }` — o `workspaceId` só chega ao service depois do guard.

Essa dupla verificação (guard + query filter) equivale ao que o RLS fazia no banco.

## 9. Esqueleto de fila

Redis + BullMQ. Fila `system`, job `health.noop` enfileirado na api e processado no worker.

## 10. Transversais

- **i18n** pt-BR.
- **Design tokens** base (CSS custom properties).
- **CI:** GitHub Actions com PostgreSQL e Redis efêmeros.

## 11. Cenários de teste

- **T1 — Onboarding:** ao fazer signup, existe 1 workspace `personal` + 1 membership `owner`.
- **T2 — Isolamento (leitura):** usuário A não recebe workspaces de B no `GET /workspaces`.
- **T3 — Isolamento (escrita):** usuário A recebe 403 ao tentar inserir membership em workspace de B.
- **T4 — Auth:** token inválido recebe 401 no `GET /workspaces`.
- **T5 — Fila:** `health.noop` processado com sucesso.
- **T6 — CI:** lint + type-check + testes verdes em banco efêmero.

## 12. Fora de escopo da Fase 0

Contas/transações (Fase 1) · categorias (Fase 1) · Storage/MinIO (Fase 2) · IA (Fase 2) · import (Fase 3) · convite real (Fase 5).

## 13. Decisões registradas

| Tema | Decisão |
|---|---|
| Banco | PostgreSQL 16 (Docker local, Railway prod) |
| ORM | Prisma (migrations tipadas, DX) |
| Auth | Better Auth (email/senha; social/2FA deferidos para Fase 8) |
| Storage | MinIO/S3 — apenas Fase 2+ |
| Isolamento | App-layer (guards + Prisma filters); RLS nativo pode ser adicionado como camada extra depois |
| Onboarding | Hook `after.signUp` no Better Auth cria workspace em Prisma transaction |
| Ledger | Quase-double-entry |
| Moeda | Por workspace, default BRL, sem câmbio |
