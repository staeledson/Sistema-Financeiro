# Fase 5 — Família & PJ · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps em checkbox.
>
> **Convenção:** scaffolding por comandos; código autoral por completo. E-mail atrás de `MailGateway` (mockado). Reusa harness/serviços das Fases 0–4. Repo: `docs/superpowers/plans/2026-06-25-fase-5-familia-pj.md`.

**Goal:** Ativar workspaces compartilhados (família) e PJ: criação de workspaces, **convite real** (e-mail → aceite), **RBAC efetivo**, troca de workspace, **divisão de despesas** e campos básicos de PJ. Inclui o **refactor** de resolução de workspace (de `limit(1)` para `X-Workspace-Id`).

**Architecture:** Toda requisição que opera em dados do workspace passa `X-Workspace-Id`; um guard valida associação (RLS reforça no banco). Criação de membership `owner` centralizada no trigger `on_workspace_created`. Convites por token com e-mail casado. Divisão registra cotas (`transaction_splits`) e gera relatório de saldo entre membros.

**Tech Stack:** NestJS (guard/decorator), Supabase Auth (e-mail do usuário), provedor de e-mail (abstraído), Vue.

## Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Resolução de workspace | Header **`X-Workspace-Id`** + guard de associação; fim do `limit(1)`. |
| 2 | Membership owner | Centralizada no **trigger** `on_workspace_created` (cobre signup pessoal e workspaces criados pelo app), sem duplicar. |
| 3 | Convite | **Token + e-mail casado**: só aceita quem está logado com o e-mail convidado. Expira. |
| 4 | RBAC | RLS (`has_role`) + **guard de papel** no app para operações sensíveis (gerir membros, convites). `viewer` é read-only. |
| 5 | Divisão de despesas | `transaction_splits` (cotas) + relatório "quem deve a quem". **Acerto/settlement adiado.** |
| 6 | PJ | `business_profiles` (CNPJ, razão social) + `transactions.cost_center`. Separação PF/PJ é inerente (workspaces distintos). |

## Global Constraints

- Refactor não pode quebrar os testes das Fases 1–4: header ausente → fallback ao workspace pessoal único (compat).
- E-mail atrás de `MailGateway` → testes sem envio real.
- Migrations continuam (próxima: `0021`).

---

## Task 1: Refactor — resolução de workspace por header

**Files:** Create `apps/api/src/workspace/workspace.guard.ts`, `workspace-id.decorator.ts`; Modify controllers/services das Fases 1–4. Test: `apps/api/test/e2e/workspace-scope.e2e.test.ts`.

**Interfaces:** Produces `@WorkspaceId()` (param) + `WorkspaceGuard`; serviços passam a receber `workspaceId` explícito. Consumido por todo o app daqui pra frente.

- [ ] **Step 1: e2e (falha primeiro)** — usuário cria conta passando `X-Workspace-Id` do seu workspace → OK; passando um id de workspace alheio → 403; sem header → usa o pessoal (compat).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Decorator + resolução** — `apps/api/src/workspace/workspace-id.decorator.ts`:
```ts
import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { clientFromToken } from "../supabase/supabase-request";

export const WorkspaceId = createParamDecorator(
  async (_data, ctx: ExecutionContext): Promise<string> => {
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers["authorization"] as string | undefined;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException();
    const sb = clientFromToken(token);
    const header = req.headers["x-workspace-id"] as string | undefined;

    if (header) {
      // RLS só deixa ver membership do próprio usuário: existe ⇒ é membro
      const { data } = await sb.from("workspace_members")
        .select("workspace_id").eq("workspace_id", header).maybeSingle();
      if (!data) throw new UnauthorizedException("não é membro deste workspace");
      return header;
    }
    const { data: ws } = await sb.from("workspaces").select("id").limit(1).single();
    return ws!.id; // compat: workspace pessoal único
  },
);
```

- [ ] **Step 4: Aplicar o refactor** — em cada service das Fases 1–4 que usava `workspaces ... limit(1)`, receber `workspaceId: string` por parâmetro; nos controllers, anotar `@WorkspaceId() workspaceId`. Rodar as suítes das Fases 1–4 e garantir verdes (compat preservada).

- [ ] **Step 5: Ver passar e commit** — `git commit -am "refactor(api): resolve workspace via X-Workspace-Id with membership guard"`

---

## Task 2: Reconciliar criação de membership owner (trigger)

**Files:** Create `supabase/migrations/0021_owner_membership_trigger.sql`. Test: `apps/api/test/database/owner_membership.test.ts`.

**Interfaces:** Produces criação de `owner` num único ponto (trigger no insert de `workspaces`), válido para signup pessoal e workspaces criados pelo app — sem duplicar.

- [ ] **Step 1: Teste (falha primeiro)** — após signup, existe **exatamente 1** membership owner (não 2); inserir um workspace com `created_by=X` gera 1 owner para X.

- [ ] **Step 2: Rodar e ver falhar** (hoje o owner vem do `handle_new_user`; ao mover pro trigger sem ajustar, daria duplicata — o teste guia o ajuste).

- [ ] **Step 3: Migration** — `supabase/migrations/0021_owner_membership_trigger.sql`:
```sql
-- on_workspace_created passa a criar a membership owner também
create or replace function on_workspace_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (workspace_id, user_id) do nothing;
  perform seed_default_categories(new.id);
  return new;
end; $$;

-- handle_new_user deixa de inserir membership (evita duplicata)
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into workspaces (type, name, currency, created_by)
  values ('personal', 'Pessoal', 'BRL', new.id);
  return new;
end; $$;
```

- [ ] **Step 4: Ver passar e commit** — `git commit -am "refactor(db): centralize owner membership creation in workspace trigger"`

---

## Task 3: Criar workspaces família/PJ

**Files:** Modify `apps/api/src/workspace/*` (create). Test: `apps/api/test/e2e/workspace-create.e2e.test.ts`.

**Interfaces:** Produces `POST /workspaces { type, name, currency }`; criador vira `owner`, categorias semeadas (via trigger). `GET /workspaces` (Fase 0) lista todos.

- [ ] **Step 1: e2e (falha primeiro)** — `POST /workspaces { type:'family', name:'Casa' }` → 201; `GET /workspaces` agora retorna 2 (pessoal + família); a família já tem as 20 categorias semeadas; o criador é owner.

- [ ] **Step 2..4: Implementar e ver passar** — service insere em `workspaces` (`created_by` = userId); o trigger cuida de owner+categorias. Validar `type` ∈ {personal,family,business}.

- [ ] **Step 5: Commit** — `git commit -am "feat(workspace): create family/business workspaces"`

---

## Task 4: Convites — criar e enviar

**Files:** Create `supabase/migrations/0022_invitations.sql`; `apps/api/src/invitations/*`; `apps/api/src/mail/mail.gateway.ts`. Test: `apps/api/test/e2e/invite.e2e.test.ts`.

**Interfaces:** Produces `invitations`; `POST /invitations { email, role }` (owner/admin) → cria token + envia e-mail (gateway). Consumido pelo aceite (Task 5).

- [ ] **Step 1: e2e (falha primeiro)** — owner convida `b@example.com` como `member` → 201, existe `invitation` pendente com token e `expires_at` futuro; `MailGateway.send` (mock) foi chamado com o e-mail e o token. `viewer` tentando convidar → 403.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0022_invitations.sql`:
```sql
create type invitation_status as enum ('pending','accepted','expired','revoked');

create table invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  role member_role not null default 'member',
  token text not null unique,
  status invitation_status not null default 'pending',
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index invitations_token_idx on invitations(token);

alter table invitations enable row level security;
-- gestão de convites: owner/admin do workspace
create policy inv_manage on invitations for all
  using (has_role(workspace_id, array['owner','admin']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin']::member_role[]));
```
> O aceite (Task 5) lê o convite por token via endpoint do app (service role), não por RLS do convidado.

- [ ] **Step 4: MailGateway** — `apps/api/src/mail/mail.gateway.ts`: interface `send(to, subject, body)` + impl com provedor (ex.: Resend) lendo `MAIL_API_KEY`; em teste, provider mock. Convite gera link `${APP_URL}/convite/${token}`.

- [ ] **Step 5: Service/controller** — `POST /invitations` (guard de papel owner/admin via `has_role`), gera token (`crypto.randomUUID()`), `expires_at = now()+7d`, persiste e chama `MailGateway`.

- [ ] **Step 6: Ver passar e commit** — `git commit -am "feat(invitations): create and email workspace invitations (owner/admin)"`

---

## Task 5: Aceitar convite (token + e-mail casado)

**Files:** Modify `apps/api/src/invitations/*`. Test: `apps/api/test/e2e/invite-accept.e2e.test.ts`.

**Interfaces:** Produces `POST /invitations/accept { token }` → cria `workspace_member` se o e-mail do usuário logado casar com o do convite e ele não estiver expirado.

- [ ] **Step 1: e2e (falha primeiro)** — convida `b@example.com`; usuário B (logado, e-mail casa) aceita → vira `member` e passa a ver o workspace; usuário C (e-mail diferente) com o mesmo token → 403; token expirado → 410.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Service** — `accept(token, callerToken)`:
```ts
async accept(token: string, callerToken: string) {
  const { data: user } = await this.admin.auth.getUser(callerToken); // e-mail do chamador
  const { data: inv } = await this.admin.from("invitations")
    .select("*").eq("token", token).maybeSingle();
  if (!inv || inv.status !== "pending") throw new NotFoundException();
  if (new Date(inv.expires_at) < new Date()) {
    await this.admin.from("invitations").update({ status: "expired" }).eq("id", inv.id);
    throw new GoneException("convite expirado");
  }
  if (user.user?.email?.toLowerCase() !== inv.email.toLowerCase())
    throw new ForbiddenException("e-mail não corresponde ao convite");

  await this.admin.from("workspace_members").insert({
    workspace_id: inv.workspace_id, user_id: user.user!.id, role: inv.role,
  });
  await this.admin.from("invitations").update({ status: "accepted" }).eq("id", inv.id);
  return { ok: true, workspaceId: inv.workspace_id };
}
```
(usa service role `admin` para ler o convite por token e inserir a membership.)

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(invitations): accept via token with email match and expiry"`

---

## Task 6: RBAC — gestão de membros

**Files:** Create `apps/api/src/members/*`. Test: `apps/api/test/e2e/members.e2e.test.ts`.

**Interfaces:** Produces `GET /members`, `PATCH /members/:userId/role`, `DELETE /members/:userId` (owner/admin; não pode remover o último owner). Reforça `viewer` read-only nas operações já existentes (RLS já garante; aqui validamos).

- [ ] **Step 1: e2e (falha primeiro)** — owner muda papel de B para `admin` (OK); `member` tentando mudar papel → 403; remover o **último owner** → 409; `viewer` tentando criar transação → bloqueado (RLS já cobre — teste confirma 4xx).

- [ ] **Step 2..4: Implementar e ver passar** — guard `has_role(owner/admin)`; checagem "último owner" antes de rebaixar/remover.

- [ ] **Step 5: Commit** — `git commit -am "feat(members): role management with last-owner protection"`

---

## Task 7: Divisão de despesas

**Files:** Create `supabase/migrations/0023_splits.sql`; `apps/api/src/splits/*`. Test: `apps/api/test/e2e/splits.e2e.test.ts`.

**Interfaces:** Produces `transaction_splits` (cotas por membro); `POST /transactions/:id/splits`, `GET /reports/member-balances` (quem deve a quem no workspace família).

- [ ] **Step 1: e2e (falha primeiro)** — numa despesa de R$100 paga por A, dividir 50/50 entre A e B → `GET /reports/member-balances` mostra B devendo R$50 a A.

- [ ] **Step 2: Migration** — `supabase/migrations/0023_splits.sql`:
```sql
create table transaction_splits (
  transaction_id uuid not null references transactions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  share_cents bigint not null check (share_cents >= 0),
  primary key (transaction_id, user_id)
);
alter table transaction_splits enable row level security;
create policy ts_all on transaction_splits for all
  using (exists (select 1 from transactions t
    where t.id = transaction_id and is_member(t.workspace_id)))
  with check (exists (select 1 from transactions t
    where t.id = transaction_id and is_member(t.workspace_id)));
```

- [ ] **Step 3: Service** — `setSplits(txId, [{userId, shareCents}])` (soma das cotas = `amount_cents`); `memberBalances(workspaceId)`: para cada transação com splits, o **pagador** (`created_by`) é credor pelo total e cada membro é devedor pela sua cota; agrega líquido por par de membros.

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(splits): expense splitting and member-balance report"`

---

## Task 8: PJ + web (switcher, convites, membros, divisão)

**Files:** Create `supabase/migrations/0024_business.sql`; web `components/WorkspaceSwitcher.vue`, `views/MembersView.vue`, `views/InviteAcceptView.vue`. Test: `apps/api/test/database/business.test.ts`; `apps/web/src/components/__tests__/workspace-switcher.test.ts`.

**Interfaces:** Produces `business_profiles` + `transactions.cost_center`; UI de troca de workspace, convites, membros e aceite.

- [ ] **Step 1: Migration** — `supabase/migrations/0024_business.sql`:
```sql
create table business_profiles (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  cnpj text,
  legal_name text
);
alter table transactions add column cost_center text;

alter table business_profiles enable row level security;
create policy bp_select on business_profiles for select using (is_member(workspace_id));
create policy bp_cud on business_profiles for all
  using (has_role(workspace_id, array['owner','admin']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin']::member_role[]));
```
Teste: campos existem; `cost_center` aceito em transação de workspace business.

- [ ] **Step 2: Web — switcher (teste falha primeiro)** — `WorkspaceSwitcher` lista `GET /workspaces`, troca o workspace ativo no store e passa a injetar `X-Workspace-Id` em todas as chamadas (`lib/api.ts`). Teste: ao selecionar outro workspace, o header das requisições muda.

- [ ] **Step 3..5: Implementar e ver passar** — `MembersView` (listar/convidar/mudar papel/remover), `InviteAcceptView` (lê token da URL → `POST /invitations/accept`), formulário de PJ (CNPJ/razão) nos workspaces business, campo `cost_center` opcional no lançamento quando o workspace é PJ.

- [ ] **Step 6: Commit** — `git commit -am "feat(business+web): PJ profile, cost center, workspace switcher and member UI"`

---

## Self-review (feito)

- **Cobertura:** refactor de escopo (Task 1) · membership reconciliada (Task 2) · criar workspaces (Task 3) · convite+aceite (Tasks 4–5) · RBAC/membros (Task 6) · divisão (Task 7) · PJ+web (Task 8).
- **Compat:** header ausente → workspace pessoal (Fases 1–4 seguem verdes).
- **Segurança:** aceite exige e-mail casado e token não expirado; gestão de membros e convites por owner/admin; "último owner" protegido; RLS reforça tudo no banco.
- **Pontos de atenção:** (a) e-mail real depende do provedor configurado (`MAIL_API_KEY`); em dev, logar o link; (b) settlement (marcar dívida como paga) ficou de fora — `member-balances` é informativo; (c) ao mudar papel para `viewer`, garantir que o front esconda ações de escrita (RLS já bloqueia no back).

---

## Execução

`subagent-driven`. Dependências: 1 → 2 → 3 → (4 → 5) → 6 → 7 → 8. A Task 1 (refactor) é pré-requisito de tudo e a mais arriscada por tocar código existente — review caprichado e suíte das Fases 1–4 verde antes de seguir.

---

> **Próxima:** Fase 6 (Chat "pergunte às suas finanças"). Decisão sensível que vou travar: **function calling sobre endpoints existentes** (consultas parametrizadas e seguras) em vez de text-to-SQL livre — o LLM escolhe entre funções whitelisted (saldo, gasto por categoria, busca de transações) que já respeitam RLS, eliminando a superfície de injeção de SQL.
