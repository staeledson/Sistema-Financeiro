# Correções da revisão de 2026-10-02 — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os bugs levantados em `docs/revisao-sistema-2026-10-02.md` (segurança, funções quebradas, validação e consistência), sem mudar o produto.

**Architecture:** Cada tarefa toca um módulo e fecha com seus próprios testes (e2e da API com Postgres/Redis locais, unitários do worker e do web). Validação de corpo segue o padrão já usado em `review.controller.ts` (`z.object(...).parse(body)` no controller). Regras de permissão ficam no guard (`CurrentUserGuard`) e nos services. Enums novos entram por migration `ALTER TYPE ... ADD VALUE`, como em `20260626210100_fase4_enum_extend`.

**Tech Stack:** NestJS 11 + Fastify 5, Prisma 7 (`apps/api/generated/prisma`), Zod 3 (`@app/shared`), Vitest, Vue 3 + Pinia, BullMQ.

## Global Constraints

- Idioma de mensagens, comentários e commits: português (pt-BR), como no restante do repositório.
- Dinheiro sempre em centavos inteiros; datas de lançamento como `YYYY-MM-DD`.
- Nunca espalhar `body` do cliente direto no Prisma: campos explícitos.
- Testes e2e da API precisam de Postgres em `localhost:5433` e Redis em `localhost:6380` (`docker compose up -d` na raiz). Eles limpam o banco `financas` inteiro: não guarde dados de dev nele.
- Comandos de teste: `pnpm --filter @app/api test`, `pnpm --filter @app/worker test`, `pnpm --filter @app/web test`, `pnpm --filter @app/shared test`; typecheck geral: `pnpm turbo typecheck`.
- Rodar um único arquivo de teste: `pnpm --filter @app/api exec vitest run test/e2e/members.e2e.test.ts`.
- Depois de mudar `prisma/schema.prisma`: `pnpm exec prisma migrate deploy && pnpm exec prisma generate` (na raiz).
- Um commit por tarefa, mensagem `fix(<área>): ...` ou `feat(<área>): ...`, terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Fora do escopo deste plano (ficam para outro): itens 20, 22, 29, 30, 31, 33, 35, 36 e 39 da revisão (subcategorias em orçamento, PDF no worker, agrupar updateMany da categorização, onboarding, erro por linha no CSV genérico, pré-compilar regex, build para `dist/` no Dockerfile, alinhar versões do Vite, fila `system` morta).

---

## Mapa de arquivos

| Tarefa | Cria | Modifica |
|---|---|---|
| 1 Membros | — | `apps/api/src/workspaces/workspaces.controller.ts`, `workspaces.service.ts`, `apps/api/test/e2e/members.e2e.test.ts` |
| 2 Convites | — | `apps/api/src/invitations/invitations.controller.ts`, `invitations.service.ts`, `apps/api/src/mail/mail.gateway.ts`, `.env.example`, `apps/api/test/e2e/members.e2e.test.ts` |
| 3 Leitor | `apps/api/src/auth/viewer-policy.ts`, `apps/api/test/unit/viewer-policy.test.ts` | `apps/api/src/auth/current-user.guard.ts`, `apps/api/test/e2e/members.e2e.test.ts` |
| 4 Validação | `apps/api/src/common/zod.ts`, `apps/api/test/e2e/validacao.e2e.test.ts` | controllers de chat, bills, goals, splits, push, ingest, import, business; `import.controller.ts` (usa `isoDateSchema` comum) |
| 5 Orçamentos | `prisma/migrations/20261002100000_budget_buckets/migration.sql` | `prisma/schema.prisma`, `apps/api/src/budgets/*`, `apps/web/src/views/BudgetsView.vue`, `apps/api/test/e2e/intelligence.e2e.test.ts` |
| 6 Insights | `prisma/migrations/20261002110000_insight_bill_due/migration.sql`, `apps/web/src/lib/insight-text.ts`, `apps/web/src/lib/__tests__/insight-text.test.ts` | `prisma/schema.prisma`, `apps/worker/src/insights/cashflow.processor.ts`, `apps/worker/src/reminders/reminders.processor.ts`, `apps/worker/test/reminders-processor.test.ts`, `apps/web/src/views/InsightsView.vue` |
| 7 Sessão web | `apps/web/src/stores/__tests__/workspace.test.ts` | `apps/web/src/stores/auth.ts`, `stores/workspace.ts`, `lib/http.ts`, `App.vue`, testes de `auth` e `http` |
| 8 Web diversos | `apps/web/src/lib/members.ts`, `lib/chat-format.ts` e testes | `views/MembersView.vue`, `views/ChatView.vue`, `index.html`; remove `apps/web/src/offline/` |
| 9 storagePath | `apps/api/src/storage/storage-path.ts`, `apps/api/test/unit/storage-path.test.ts` | `ingest/ingest.service.ts`, `import/import.service.ts`, `apps/api/test/e2e/ingest.e2e.test.ts` |
| 10 Commit import | — | `apps/api/src/import/import.service.ts`, `apps/api/test/e2e/import-statements.e2e.test.ts` |
| 11 Entidade/pega-tudo | `apps/api/test/e2e/guardas-entidade.e2e.test.ts` | `categories/categories.service.ts`, `accounts/accounts.service.ts` |
| 12 Fuso | `packages/shared/src/time.ts`, `packages/shared/src/__tests__/time.test.ts` | `packages/shared/src/index.ts`, `budgets.*`, `apps/worker/src/insights/*.ts`, `BudgetsView.vue`, `.env.example` |
| 13 Worker | `apps/worker/src/ai/mime.ts`, `apps/worker/test/mime.test.ts` | `ai/openrouter.ts`, `ai/ingest.processor.ts`, `insights/compute.processor.ts`, `reminders/reminders.processor.ts` e teste |
| 14 Miscelânea | — | `chat/chat.service.ts`, `import/import-statement.service.ts`, `import/import.service.ts`, `splits/splits.service.ts`, `packages/shared/src/ofx.ts` e teste, `.github/workflows/ci.yml` |

---

### Task 1: Permissões de membros do workspace

**Files:**
- Modify: `apps/api/src/workspaces/workspaces.controller.ts`
- Modify: `apps/api/src/workspaces/workspaces.service.ts`
- Test: `apps/api/test/e2e/members.e2e.test.ts`

**Interfaces:**
- Produces: `WorkspacesService.assertMember(workspaceId, userId)` (lança `ForbiddenException`); `createWorkspaceBody`, `addMemberBody`, `updateRoleBody` (Zod) no controller.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `apps/api/test/e2e/members.e2e.test.ts` (antes do fechamento do arquivo), usando os mesmos `app`, `auth` e `prisma` já importados:

```ts
async function signUp(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  return {
    id: u!.user.id,
    wsId: ws.id,
    h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" },
  };
}

describe("Permissões de membros", () => {
  it("GET /workspaces/:id/members de um workspace alheio responde 403", async () => {
    const a = await signUp("perm_a");
    const b = await signUp("perm_b");
    const res = await app.inject({ method: "GET", url: `/workspaces/${b.wsId}/members`, headers: a.h });
    expect(res.statusCode).toBe(403);
    const own = await app.inject({ method: "GET", url: `/workspaces/${a.wsId}/members`, headers: a.h });
    expect(own.statusCode).toBe(200);
    expect(own.json()).toHaveLength(1);
  });

  it("role inválido em POST e PATCH responde 400", async () => {
    const owner = await signUp("perm_role");
    const other = await signUp("perm_role2");
    const add = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: other.id, role: "deus" },
    });
    expect(add.statusCode).toBe(400);
    const patch = await app.inject({
      method: "PATCH", url: `/workspaces/${owner.wsId}/members/${owner.id}/role`, headers: owner.h,
      payload: { role: "" },
    });
    expect(patch.statusCode).toBe(400);
  });

  it("admin não rebaixa um owner (403) e o único owner não pode ser rebaixado (409)", async () => {
    const owner = await signUp("perm_owner");
    const admin = await signUp("perm_admin");
    await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: admin.id, role: "admin" },
    });
    const byAdmin = await app.inject({
      method: "PATCH", url: `/workspaces/${owner.wsId}/members/${owner.id}/role`, headers: admin.h,
      payload: { role: "member" },
    });
    expect(byAdmin.statusCode).toBe(403);
    const byOwner = await app.inject({
      method: "PATCH", url: `/workspaces/${owner.wsId}/members/${owner.id}/role`, headers: owner.h,
      payload: { role: "member" },
    });
    expect(byOwner.statusCode).toBe(409);
  });

  it("adicionar usuário inexistente responde 404 e repetido responde 409", async () => {
    const owner = await signUp("perm_dup");
    const other = await signUp("perm_dup2");
    const missing = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: "nao-existe", role: "member" },
    });
    expect(missing.statusCode).toBe(404);
    const first = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: other.id, role: "member" },
    });
    expect(first.statusCode).toBe(201);
    const again = await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: other.id, role: "member" },
    });
    expect(again.statusCode).toBe(409);
  });

  it("POST /workspaces valida tipo e nome", async () => {
    const u = await signUp("perm_ws");
    const bad = await app.inject({ method: "POST", url: "/workspaces", headers: u.h, payload: { type: "clube", name: "" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/workspaces", headers: u.h, payload: { type: "family", name: "  Casa  " } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().name).toBe("Casa");
    expect(ok.json().currency).toBe("BRL");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/members.e2e.test.ts`
Expected: os 5 testes novos FALHAM (200 em vez de 403; 500 em vez de 400/404/409).

- [ ] **Step 3: Controller com schemas Zod**

Substituir `apps/api/src/workspaces/workspaces.controller.ts` por:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { MEMBER_ROLES, WORKSPACE_TYPES } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspacesService } from "./workspaces.service";

const roleSchema = z.enum(MEMBER_ROLES);
const createWorkspaceBody = z.object({
  type: z.enum(WORKSPACE_TYPES),
  name: z.string().trim().min(1).max(80),
  currency: z.string().trim().length(3).toUpperCase().default("BRL"),
});
const addMemberBody = z.object({ userId: z.string().min(1), role: roleSchema });
const updateRoleBody = z.object({ role: roleSchema });

@Controller("workspaces")
@UseGuards(CurrentUserGuard)
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listForUser(user.id);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.id, createWorkspaceBody.parse(body));
  }

  /** Só membros do workspace enxergam a lista (nome e e-mail dos demais). */
  @Get(":id/members")
  async listMembers(@Param("id") workspaceId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.service.assertMember(workspaceId, user.id);
    return this.service.listMembers(workspaceId);
  }

  @Post(":id/members")
  @HttpCode(201)
  addMember(@Param("id") workspaceId: string, @CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.addMember(workspaceId, user.id, addMemberBody.parse(body));
  }

  @Patch(":id/members/:userId/role")
  @HttpCode(200)
  updateMemberRole(
    @Param("id") workspaceId: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.service.updateMemberRole(workspaceId, user.id, targetUserId, updateRoleBody.parse(body).role);
  }

  @Delete(":id/members/:userId")
  @HttpCode(200)
  removeMember(
    @Param("id") workspaceId: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.removeMember(workspaceId, user.id, targetUserId);
  }
}
```

- [ ] **Step 4: Service com as regras**

Substituir `apps/api/src/workspaces/workspaces.service.ts` por:

```ts
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberRole, WorkspaceType } from "../../generated/prisma/enums";
import { prisma } from "../database";
import { seedDefaultCategories } from "../categories/seed-categories";

const ALLOWED_ROLE_MANAGE: MemberRole[] = ["owner", "admin"];

@Injectable()
export class WorkspacesService {
  async listForUser(userId: string) {
    return prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      select: { id: true, type: true, name: true, currency: true, createdById: true },
    });
  }

  async create(userId: string, body: { type: WorkspaceType; name: string; currency: string }) {
    const workspace = await prisma.workspace.create({
      data: {
        type: body.type,
        name: body.name,
        currency: body.currency,
        createdById: userId,
        members: { create: { userId, role: "owner" } },
      },
      select: { id: true, type: true, name: true, currency: true },
    });
    await seedDefaultCategories(workspace.id);
    return workspace;
  }

  /** 403 quando o usuário não é membro do workspace (qualquer papel serve). */
  async assertMember(workspaceId: string, userId: string) {
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!m) throw new ForbiddenException("não é membro deste workspace");
    return m.role;
  }

  async addMember(workspaceId: string, requesterId: string, body: { userId: string; role: MemberRole }) {
    const requesterRole = await this.assertManagePermission(workspaceId, requesterId);
    if (body.role === "owner" && requesterRole !== "owner") throw new ForbiddenException("apenas owner pode adicionar outro owner");

    const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
    if (!user) throw new NotFoundException("usuário não encontrado");

    const existing = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: body.userId } },
      select: { id: true },
    });
    if (existing) throw new ConflictException("o usuário já é membro deste workspace");

    return prisma.workspaceMember.create({
      data: { workspaceId, userId: body.userId, role: body.role },
    });
  }

  async listMembers(workspaceId: string) {
    return prisma.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        id: true, role: true, createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Owner muda qualquer papel; admin muda só papéis abaixo de owner (nem promove nem rebaixa owner).
   * O único owner não pode ser rebaixado.
   */
  async updateMemberRole(workspaceId: string, requesterId: string, targetUserId: string, role: MemberRole) {
    const requesterRole = await this.assertManagePermission(workspaceId, requesterId);

    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { id: true, role: true },
    });
    if (!target) throw new NotFoundException("membro não encontrado");

    if ((target.role === "owner" || role === "owner") && requesterRole !== "owner") {
      throw new ForbiddenException("apenas owner altera o papel de um owner ou promove a owner");
    }
    if (target.role === "owner" && role !== "owner") await this.assertNotLastOwner(workspaceId, targetUserId);

    return prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role },
      select: { id: true, role: true },
    });
  }

  async removeMember(workspaceId: string, requesterId: string, targetUserId: string) {
    const requesterRole = await this.assertManagePermission(workspaceId, requesterId);

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { id: true, role: true },
    });
    if (!membership) throw new NotFoundException("membro não encontrado");
    if (membership.role === "owner" && requesterRole !== "owner") throw new ForbiddenException("apenas owner remove um owner");
    await this.assertNotLastOwner(workspaceId, targetUserId);

    await prisma.workspaceMember.delete({ where: { id: membership.id } });
    return { removed: true };
  }

  private async assertManagePermission(workspaceId: string, userId: string): Promise<MemberRole> {
    const m = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!m || !ALLOWED_ROLE_MANAGE.includes(m.role)) throw new ForbiddenException("sem permissão");
    return m.role;
  }

  private async assertNotLastOwner(workspaceId: string, targetUserId: string) {
    const target = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      select: { role: true },
    });
    if (target?.role !== "owner") return;

    const ownerCount = await prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } });
    if (ownerCount <= 1) throw new ConflictException("não é possível remover ou rebaixar o único owner do workspace");
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/members.e2e.test.ts test/e2e/workspaces.e2e.test.ts`
Expected: PASS (todos, inclusive os antigos T3 e "owner pode adicionar").

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workspaces apps/api/test/e2e/members.e2e.test.ts
git commit -m "fix(workspaces): lista de membros só para membros, papéis validados e único owner protegido

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Convites validados e remetente configurável

**Files:**
- Modify: `apps/api/src/invitations/invitations.controller.ts`
- Modify: `apps/api/src/invitations/invitations.service.ts:12-28`
- Modify: `apps/api/src/mail/mail.gateway.ts:36`
- Modify: `.env.example`
- Test: `apps/api/test/e2e/members.e2e.test.ts`

- [ ] **Step 1: Testes que falham**

Acrescentar ao `describe("Permissões de membros")` de `members.e2e.test.ts`:

```ts
  it("convite recusa papel owner e e-mail inválido (400) e normaliza o e-mail", async () => {
    const owner = await signUp("perm_inv");
    const asOwner = await app.inject({ method: "POST", url: "/invitations", headers: owner.h, payload: { email: "x@y.com", role: "owner" } });
    expect(asOwner.statusCode).toBe(400);
    const badEmail = await app.inject({ method: "POST", url: "/invitations", headers: owner.h, payload: { email: "nao-e-email" } });
    expect(badEmail.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/invitations", headers: owner.h, payload: { email: "  Ana@Exemplo.com " } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().email).toBe("ana@exemplo.com");
    expect(ok.json().role).toBe("member");
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/members.e2e.test.ts -t "convite recusa"`
Expected: FAIL (201 ou 500 em vez de 400).

- [ ] **Step 3: Controller com schema**

Substituir o conteúdo de `apps/api/src/invitations/invitations.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { InvitationsService } from "./invitations.service";

/** Convite nunca concede owner: a promoção é feita depois, pelo próprio owner. */
const createBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});
const acceptBody = z.object({ token: z.string().min(1).max(200) });

@Controller("invitations")
@UseGuards(CurrentUserGuard)
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, user.id, user.role, createBody.parse(body));
  }

  @Post("accept")
  @HttpCode(200)
  accept(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.accept(acceptBody.parse(body).token, user.email, user.id);
  }

  @Delete(":id")
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.revoke(user.workspaceId, id, user.role);
  }
}
```

- [ ] **Step 4: Service tipado**

Em `apps/api/src/invitations/invitations.service.ts`, trocar a assinatura e o `create` do `prisma.invitation`:

```ts
  async create(
    workspaceId: string,
    invitedById: string,
    callerRole: string,
    body: { email: string; role: "admin" | "member" | "viewer" },
  ) {
    if (!ALLOWED_TO_INVITE.includes(callerRole)) {
      throw new ForbiddenException("apenas owner ou admin podem convidar");
    }

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await prisma.invitation.create({
      data: {
        workspaceId,
        email: body.email,
        role: body.role,
        expiresAt,
        invitedById,
      },
      select: { id: true, token: true, email: true, role: true, expiresAt: true },
    });
```
(o restante do método continua igual).

- [ ] **Step 5: Remetente por variável de ambiente**

Em `apps/api/src/mail/mail.gateway.ts`, trocar a função `createResendProvider`:

```ts
function createResendProvider(apiKey: string): MailProvider {
  const from = process.env["MAIL_FROM"]?.trim() || "noreply@sistema-financeiro.app";
  return {
    async send(to, subject, html) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, html }),
      });
      if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    },
  };
}
```

Em `.env.example`, acrescentar depois do bloco de autenticação:

```dotenv
# ─── E-mail (convites) ─────────────────────────────────────────────────────────
# Sem MAIL_API_KEY o convite só aparece no log e na tela (modo dev).
# MAIL_API_KEY=
# Remetente verificado no Resend (obrigatório em produção para o convite chegar).
# MAIL_FROM=convites@seu-dominio.com.br
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/members.e2e.test.ts test/e2e/familia-pj.e2e.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/invitations apps/api/src/mail/mail.gateway.ts .env.example apps/api/test/e2e/members.e2e.test.ts
git commit -m "fix(convites): valida e-mail e papel (nunca owner) e lê o remetente de MAIL_FROM

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Papel `viewer` somente leitura

**Files:**
- Create: `apps/api/src/auth/viewer-policy.ts`
- Create: `apps/api/test/unit/viewer-policy.test.ts`
- Modify: `apps/api/src/auth/current-user.guard.ts:56-65`
- Test: `apps/api/test/e2e/members.e2e.test.ts`

**Interfaces:**
- Produces: `viewerMayCall(method: string, url: string): boolean`.

- [ ] **Step 1: Teste unitário**

Criar `apps/api/test/unit/viewer-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { viewerMayCall } from "../../src/auth/viewer-policy";

describe("viewerMayCall", () => {
  it("leitura sempre pode", () => {
    expect(viewerMayCall("GET", "/transactions?from=2026-01-01")).toBe(true);
    expect(viewerMayCall("GET", "/export/analise.csv")).toBe(true);
  });
  it("escrita no financeiro não pode", () => {
    expect(viewerMayCall("POST", "/transactions")).toBe(false);
    expect(viewerMayCall("PATCH", "/accounts/abc")).toBe(false);
    expect(viewerMayCall("DELETE", "/categories/abc")).toBe(false);
    expect(viewerMayCall("POST", "/import/x/commit")).toBe(false);
  });
  it("ações da própria conta e do chat podem", () => {
    expect(viewerMayCall("POST", "/invitations/accept")).toBe(true);
    expect(viewerMayCall("POST", "/workspaces")).toBe(true);
    expect(viewerMayCall("POST", "/push/subscribe")).toBe(true);
    expect(viewerMayCall("POST", "/chat")).toBe(true);
    expect(viewerMayCall("POST", "/workspaces/abc/members")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api exec vitest run test/unit/viewer-policy.test.ts`
Expected: FAIL ("Cannot find module").

- [ ] **Step 3: Implementar a política**

Criar `apps/api/src/auth/viewer-policy.ts`:

```ts
/**
 * O papel `viewer` só lê. As exceções são ações que não tocam o financeiro do workspace:
 * aceitar outro convite, criar o próprio workspace, inscrever push e conversar com o chat (que só consulta).
 */
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const VIEWER_WRITE_ALLOWLIST: RegExp[] = [/^\/invitations\/accept$/, /^\/workspaces$/, /^\/push\/subscribe$/, /^\/chat$/];

export function viewerMayCall(method: string, url: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return true;
  const path = url.split("?")[0].replace(/\/+$/, "");
  return VIEWER_WRITE_ALLOWLIST.some((re) => re.test(path));
}
```

- [ ] **Step 4: Aplicar no guard**

Em `apps/api/src/auth/current-user.guard.ts`: importar `ForbiddenException` de `@nestjs/common` e `viewerMayCall` de `./viewer-policy`; logo antes de `req.user = {` inserir:

```ts
    if (membership.role === "viewer" && !viewerMayCall(req.method, req.url)) {
      throw new ForbiddenException("perfil leitor: somente leitura neste workspace");
    }
```

- [ ] **Step 5: Teste e2e**

Acrescentar ao `describe("Permissões de membros")`:

```ts
  it("viewer lê mas não escreve no workspace", async () => {
    const owner = await signUp("perm_view");
    const viewer = await signUp("perm_view2");
    await app.inject({
      method: "POST", url: `/workspaces/${owner.wsId}/members`, headers: owner.h,
      payload: { userId: viewer.id, role: "viewer" },
    });
    const vh = { ...viewer.h, "x-workspace-id": owner.wsId };
    const read = await app.inject({ method: "GET", url: "/accounts", headers: vh });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({ method: "POST", url: "/accounts", headers: vh, payload: { type: "cash", name: "Bolso" } });
    expect(write.statusCode).toBe(403);
    // no próprio workspace (onde é owner) continua escrevendo
    const ownWrite = await app.inject({ method: "POST", url: "/accounts", headers: viewer.h, payload: { type: "cash", name: "Bolso" } });
    expect(ownWrite.statusCode).toBe(201);
  });
```

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @app/api exec vitest run test/unit/viewer-policy.test.ts test/e2e/members.e2e.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/auth apps/api/test/unit/viewer-policy.test.ts apps/api/test/e2e/members.e2e.test.ts
git commit -m "feat(auth): papel viewer passa a ser somente leitura

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Validação de corpo nos controllers antigos

**Files:**
- Create: `apps/api/src/common/zod.ts`
- Create: `apps/api/test/e2e/validacao.e2e.test.ts`
- Modify: `apps/api/src/chat/chat.controller.ts`, `bills/bills.controller.ts`, `bills/bills.service.ts`, `goals/goals.controller.ts`, `goals/goals.service.ts`, `splits/splits.controller.ts`, `splits/splits.service.ts`, `push/push.controller.ts`, `ingest/ingest.controller.ts`, `import/import.controller.ts`, `business/business.controller.ts`

**Interfaces:**
- Produces: `isoDateSchema` (Zod, `YYYY-MM-DD` real) em `apps/api/src/common/zod.ts`, reutilizado pelas tarefas 5 e 12.

- [ ] **Step 1: Teste e2e tabelado**

Criar `apps/api/test/e2e/validacao.e2e.test.ts`:

```ts
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";

let app: NestFastifyApplication;
let h: Record<string, string>;
let userId: string;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const u = await auth.api.signUpEmail({ body: { email: `val_${Date.now()}@test.com`, password: "senha123!", name: "Val" } });
  userId = u!.user.id;
  h = { authorization: `Bearer ${u!.token}`, "content-type": "application/json" };
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

const CASES: Array<{ name: string; method: "POST"; url: string; payload: unknown }> = [
  { name: "chat sem mensagem", method: "POST", url: "/chat", payload: {} },
  { name: "bill com valor decimal", method: "POST", url: "/bills", payload: { name: "Luz", amountCents: 10.5, dueDate: "2026-10-10" } },
  { name: "bill com data inválida", method: "POST", url: "/bills", payload: { name: "Luz", amountCents: 1000, dueDate: "10/10/2026" } },
  { name: "goal com alvo decimal", method: "POST", url: "/goals", payload: { name: "Viagem", targetCents: 99.9 } },
  { name: "split sem lista", method: "POST", url: "/transactions/qualquer/splits", payload: { splits: "x" } },
  { name: "push sem keys", method: "POST", url: "/push/subscribe", payload: { endpoint: "https://a.b/c" } },
  { name: "ingest texto vazio", method: "POST", url: "/ingest/text", payload: { text: "   " } },
  { name: "upload-url com extensão suspeita", method: "POST", url: "/ingest/upload-url", payload: { ext: "../x", contentType: "image/png" } },
  { name: "csv preview sem csv", method: "POST", url: "/import/csv/preview", payload: { accountId: "a", mapping: {} } },
  { name: "mapping com formato inválido", method: "POST", url: "/import/mappings", payload: { name: "x", format: "xml", mapping: {} } },
  { name: "business com cnpj curto", method: "POST", url: "/business-profile", payload: { cnpj: "123" } },
];

describe("Corpos inválidos respondem 400 (nunca 500)", () => {
  for (const c of CASES) {
    it(c.name, async () => {
      const res = await app.inject({ method: c.method, url: c.url, headers: h, payload: c.payload as object });
      expect(res.statusCode, res.body).toBe(400);
    });
  }

  it("goal com contribuição negativa responde 400 e positiva 201", async () => {
    const goal = await app.inject({ method: "POST", url: "/goals", headers: h, payload: { name: "Reserva", targetCents: 100000 } });
    expect(goal.statusCode).toBe(201);
    const id = goal.json().id as string;
    const neg = await app.inject({ method: "POST", url: `/goals/${id}/contribute`, headers: h, payload: { amountCents: -5 } });
    expect(neg.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/goals/${id}/contribute`, headers: h, payload: { amountCents: 500, date: "2026-10-01" } });
    expect(ok.statusCode).toBe(201);
  });

  it("split exige que todos os usuários sejam membros do workspace", async () => {
    const acc = await app.inject({ method: "POST", url: "/accounts", headers: h, payload: { type: "cash", name: "Bolso" } });
    const tx = await app.inject({
      method: "POST", url: "/transactions", headers: h,
      payload: { type: "expense", amountCents: 1000, date: "2026-10-01", accountId: acc.json().id },
    });
    const res = await app.inject({
      method: "POST", url: `/transactions/${tx.json().id}/splits`, headers: h,
      payload: { splits: [{ userId, shareCents: 500 }, { userId: "estranho", shareCents: 500 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/validacao.e2e.test.ts`
Expected: a maioria FALHA com 500/201.

- [ ] **Step 3: Helper comum de data**

Criar `apps/api/src/common/zod.ts`:

```ts
import { z } from "zod";

/** `YYYY-MM-DD` que existe no calendário (rejeita 2026-02-30). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "data no formato YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "data inválida");

/** Centavos: inteiro positivo dentro da faixa segura. */
export const centsSchema = z.number().int().positive().safe();
```

Em `apps/api/src/import/import.controller.ts`, apagar a constante local `isoDate` (linhas 16-19) e usar `isoDateSchema` importado de `../common/zod` nos dois lugares (`date: isoDateSchema`, `postedDate: isoDateSchema.nullish()`).

- [ ] **Step 4: Chat**

Substituir `apps/api/src/chat/chat.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ChatService } from "./chat.service";
import type { AuthenticatedUser } from "../auth/current-user.guard";

const sendBody = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).optional(),
});

@Controller()
@UseGuards(CurrentUserGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post("chat")
  async send(@Body() body: unknown, @Req() req: { user: AuthenticatedUser }) {
    const b = sendBody.parse(body);
    return this.chat.send(req.user.workspaceId, req.user.id, b.message, b.conversationId);
  }

  @Get("chat")
  listConversations(@Req() req: { user: AuthenticatedUser }) {
    return this.chat.listConversations(req.user.workspaceId);
  }

  @Get("chat/:id")
  getHistory(@Param("id") id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.chat.getHistory(req.user.workspaceId, id);
  }
}
```

- [ ] **Step 5: Contas agendadas**

Substituir `apps/api/src/bills/bills.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, AuthenticatedUser } from "../auth/current-user.guard";
import { centsSchema, isoDateSchema } from "../common/zod";
import { BillsService } from "./bills.service";

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  amountCents: centsSchema,
  dueDate: isoDateSchema,
  recurrence: z.enum(["once", "weekly", "monthly", "yearly"]).default("monthly"),
  categoryId: z.string().min(1).nullish(),
});
export type BillInput = z.infer<typeof createBody>;

@Controller("bills")
@UseGuards(CurrentUserGuard)
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  list(@Req() req: { user: AuthenticatedUser }) {
    return this.bills.list(req.user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @Req() req: { user: AuthenticatedUser }) {
    return this.bills.create(req.user.workspaceId, req.user.id, createBody.parse(body));
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.bills.remove(req.user.workspaceId, id);
  }
}
```

Em `apps/api/src/bills/bills.service.ts`, trocar `create`:

```ts
  async create(
    workspaceId: string,
    userId: string,
    body: { name: string; amountCents: number; dueDate: string; recurrence: "once" | "weekly" | "monthly" | "yearly"; categoryId?: string | null },
  ) {
    if (body.categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: body.categoryId, workspaceId }, select: { id: true } });
      if (!cat) throw new BadRequestException("categoria inexistente no workspace");
    }
    return prisma.scheduledBill.create({
      data: {
        workspaceId,
        createdById: userId,
        name: body.name,
        amountCents: BigInt(body.amountCents),
        dueDate: new Date(body.dueDate),
        recurrence: body.recurrence,
        categoryId: body.categoryId ?? null,
      },
      select: { id: true, name: true, amountCents: true, dueDate: true, recurrence: true, active: true },
    });
  }
```
e importar `BadRequestException` de `@nestjs/common` (manter `ForbiddenException` só se ainda for usado; se não, remover do import).

Atenção: o status de criação passa de 200 (padrão do Nest para POST é 201; o controller antigo não tinha `@HttpCode`, então já era 201). Confirmar com `grep -n "bills" apps/api/test/e2e/pwa.e2e.test.ts` que os testes esperam 201.

- [ ] **Step 6: Metas**

Substituir `apps/api/src/goals/goals.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { centsSchema, isoDateSchema } from "../common/zod";
import { GoalsService } from "./goals.service";

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  targetCents: centsSchema,
  deadline: isoDateSchema.nullish(),
});
const contributeBody = z.object({ amountCents: centsSchema, date: isoDateSchema.optional() });

@Controller("goals")
@UseGuards(CurrentUserGuard)
export class GoalsController {
  constructor(private readonly service: GoalsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, createBody.parse(body));
  }

  @Delete(":id")
  @HttpCode(200)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }

  @Post(":id/contribute")
  @HttpCode(201)
  contribute(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.contribute(user.workspaceId, id, user.id, contributeBody.parse(body));
  }
}
```

Em `goals.service.ts` nada muda além dos tipos (já aceita `deadline?: string | null` e `date?: string`).

- [ ] **Step 7: Splits**

Substituir `apps/api/src/splits/splits.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SplitsService } from "./splits.service";

const splitsBody = z.object({
  splits: z.array(z.object({ userId: z.string().min(1), shareCents: z.number().int().nonnegative().safe() })).min(1).max(50),
});

@Controller()
@UseGuards(CurrentUserGuard)
export class SplitsController {
  constructor(private readonly service: SplitsService) {}

  @Post("transactions/:id/splits")
  @HttpCode(200)
  setSplits(@CurrentUser() user: AuthenticatedUser, @Param("id") transactionId: string, @Body() body: unknown) {
    return this.service.setSplits(user.workspaceId, transactionId, splitsBody.parse(body).splits);
  }

  @Get("reports/member-balances")
  memberBalances(@CurrentUser() user: AuthenticatedUser) {
    return this.service.memberBalances(user.workspaceId);
  }
}
```

Em `apps/api/src/splits/splits.service.ts`, no início de `setSplits` (antes de buscar a transação), acrescentar:

```ts
    const userIds = [...new Set(splits.map((s) => s.userId))];
    if (userIds.length !== splits.length) throw new BadRequestException("usuário repetido nas cotas");
    const members = await prisma.workspaceMember.count({ where: { workspaceId, userId: { in: userIds } } });
    if (members !== userIds.length) throw new BadRequestException("todas as cotas devem ser de membros do workspace");
```

- [ ] **Step 8: Push**

Substituir `apps/api/src/push/push.controller.ts`:

```ts
import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, AuthenticatedUser } from "../auth/current-user.guard";
import { prisma } from "../database";

const subscribeBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

@Controller("push")
@UseGuards(CurrentUserGuard)
export class PushController {
  /** O endpoint identifica o navegador: se outro usuário entrar no mesmo aparelho, a inscrição passa a ser dele. */
  @Post("subscribe")
  async subscribe(@Body() body: unknown, @Req() req: { user: AuthenticatedUser }) {
    const b = subscribeBody.parse(body);
    await prisma.pushSubscription.upsert({
      where: { endpoint: b.endpoint },
      update: { p256dh: b.keys.p256dh, auth: b.keys.auth, userId: req.user.id, workspaceId: req.user.workspaceId },
      create: {
        workspaceId: req.user.workspaceId,
        userId: req.user.id,
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
      },
    });
    return { ok: true };
  }

  @Get("vapid-public-key")
  getVapidKey() {
    return { key: process.env.VAPID_PUBLIC_KEY ?? "" };
  }
}
```

- [ ] **Step 9: Ingestão**

Substituir `apps/api/src/ingest/ingest.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { IngestService } from "./ingest.service";

const textBody = z.object({ text: z.string().trim().min(1).max(2000) });
const uploadUrlBody = z.object({
  ext: z.string().trim().toLowerCase().regex(/^[a-z0-9]{1,8}$/, "extensão inválida"),
  contentType: z.string().trim().regex(/^(image|audio|application)\/[\w.+-]{1,60}$/, "tipo de conteúdo inválido"),
});
const storagePathBody = z.object({ storagePath: z.string().min(1).max(300) });

@Controller("ingest")
@UseGuards(CurrentUserGuard)
export class IngestController {
  constructor(private readonly service: IngestService) {}

  @Post("text")
  @HttpCode(201)
  text(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.enqueueText(user.workspaceId, user.id, textBody.parse(body).text);
  }

  @Post("upload-url")
  @HttpCode(201)
  uploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const b = uploadUrlBody.parse(body);
    return this.service.getUploadUrl(user.workspaceId, b.ext, b.contentType);
  }

  @Post("image")
  @HttpCode(201)
  image(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.enqueueFile(user.workspaceId, user.id, "parse_image", storagePathBody.parse(body).storagePath);
  }

  @Post("audio")
  @HttpCode(201)
  audio(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.enqueueFile(user.workspaceId, user.id, "parse_audio", storagePathBody.parse(body).storagePath);
  }

  @Get("jobs/:id")
  job(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.getJob(user.workspaceId, id);
  }
}
```

- [ ] **Step 10: Importação (rotas restantes)**

Em `apps/api/src/import/import.controller.ts`, acrescentar os schemas junto aos existentes:

```ts
const csvPreviewBody = z.object({
  accountId: z.string().min(1),
  mapping: z.record(z.unknown()),
  csv: z.string().min(1).max(5_000_000),
});
const pdfBody = z.object({ storagePath: z.string().min(1).max(300) });
const mappingBody = z.object({
  name: z.string().trim().min(1).max(80),
  format: z.enum(["csv", "ofx", "pdf"]),
  mapping: z.record(z.unknown()),
});
```

e trocar os três handlers:

```ts
  @Post("csv/preview")
  @HttpCode(200)
  csvPreview(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const b = csvPreviewBody.parse(body);
    return this.service.csvPreview(user.workspaceId, user.id, b.accountId, b.mapping, b.csv);
  }

  @Post("pdf")
  @HttpCode(201)
  enqueuePdf(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.enqueuePdf(user.workspaceId, user.id, pdfBody.parse(body).storagePath);
  }

  @Post("mappings")
  @HttpCode(201)
  saveMapping(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const b = mappingBody.parse(body);
    return this.service.saveMapping(user.workspaceId, b.name, b.format, b.mapping);
  }
```

Em `import.service.ts`, `csvPreview` também deve conferir a conta: logo após `const mapping = csvMappingSchema.parse(mappingRaw);` inserir

```ts
    const account = await prisma.bankAccount.findFirst({ where: { id: accountId, workspaceId }, select: { id: true } });
    if (!account) throw new NotFoundException("conta não encontrada");
```

- [ ] **Step 11: Perfil PJ**

Em `apps/api/src/business/business.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { BusinessService } from "./business.service";

const profileBody = z.object({
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ""))
    .refine((v) => v.length === 14, "CNPJ precisa ter 14 dígitos")
    .nullish(),
  legalName: z.string().trim().min(1).max(200).nullish(),
});

@Controller("business-profile")
@UseGuards(CurrentUserGuard)
export class BusinessController {
  constructor(private readonly service: BusinessService) {}

  @Get()
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getProfile(user.workspaceId);
  }

  @Post()
  @HttpCode(200)
  upsertProfile(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.upsertProfile(user.workspaceId, user.role, profileBody.parse(body));
  }
}
```

- [ ] **Step 12: Rodar tudo da API**

Run: `pnpm --filter @app/api test`
Expected: PASS. Se algum teste antigo esperar 500/201 onde agora vem 400, ajustar o teste (o comportamento novo é o correto).

- [ ] **Step 13: Commit**

```bash
git add apps/api/src apps/api/test/e2e/validacao.e2e.test.ts
git commit -m "fix(api): valida o corpo de chat, contas agendadas, metas, splits, push, ingestão, importação e perfil PJ

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Orçamentos por bucket (50/30/20) funcionando

**Files:**
- Create: `prisma/migrations/20261002100000_budget_buckets/migration.sql`
- Modify: `prisma/schema.prisma` (enum `BudgetMethod`)
- Modify: `apps/api/src/budgets/budgets.controller.ts`, `budgets.service.ts`
- Modify: `apps/web/src/views/BudgetsView.vue`
- Test: `apps/api/test/e2e/intelligence.e2e.test.ts`

**Interfaces:**
- Produces: `BudgetMethod = fixed | fifty_thirty_twenty | needs | wants | savings`; `GET /budgets/status` devolve `{ id, method, categoryId, limitCents, spentCents, pct }` (um orçamento legado `fifty_thirty_twenty` vira três linhas com o mesmo `id`).

- [ ] **Step 1: Migration e schema**

Criar `prisma/migrations/20261002100000_budget_buckets/migration.sql`:

```sql
-- Orçamento 50/30/20 por bucket: a tela sempre enviou needs/wants/savings.
ALTER TYPE "BudgetMethod" ADD VALUE 'needs';
ALTER TYPE "BudgetMethod" ADD VALUE 'wants';
ALTER TYPE "BudgetMethod" ADD VALUE 'savings';
```

Em `prisma/schema.prisma`:

```prisma
enum BudgetMethod {
  fixed
  fifty_thirty_twenty
  needs
  wants
  savings
}
```

Run: `pnpm exec prisma migrate deploy && pnpm exec prisma generate`
Expected: migration aplicada, clientes gerados em `apps/api/generated` e `apps/worker/generated`.

- [ ] **Step 2: Teste e2e**

Em `apps/api/test/e2e/intelligence.e2e.test.ts`, dentro de `describe("Fase 4 — Budgets")`, acrescentar:

```ts
  it("orçamento por bucket (needs) é aceito e aparece no status; fixo exige categoria", async () => {
    const { h } = await seed("ti7b");
    const bucket = await app.inject({ method: "POST", url: "/budgets", payload: { method: "needs" }, headers: h });
    expect(bucket.statusCode).toBe(200);
    expect(bucket.json().method).toBe("needs");

    const semCategoria = await app.inject({ method: "POST", url: "/budgets", payload: { method: "fixed", limitCents: 1000 }, headers: h });
    expect(semCategoria.statusCode).toBe(400);

    const status = await app.inject({ method: "GET", url: "/budgets/status", headers: h });
    const row = status.json().find((b: { method: string }) => b.method === "needs");
    expect(row).toBeTruthy();
    expect(typeof row.spentCents).toBe("number");
    expect(typeof row.limitCents).toBe("number");
  });
```

Run: `pnpm --filter @app/api exec vitest run test/e2e/intelligence.e2e.test.ts -t "bucket"`
Expected: FAIL (500 no POST needs).

- [ ] **Step 3: Controller**

Substituir `apps/api/src/budgets/budgets.controller.ts`:

```ts
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { isoDateSchema } from "../common/zod";
import { BudgetsService } from "./budgets.service";

const upsertBody = z
  .object({
    method: z.enum(["fixed", "needs", "wants", "savings"]),
    categoryId: z.string().min(1).nullish(),
    limitCents: z.number().int().nonnegative().safe().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.method === "fixed") {
      if (!v.categoryId) ctx.addIssue({ code: "custom", message: "orçamento fixo exige categoria" });
      if (v.limitCents == null) ctx.addIssue({ code: "custom", message: "orçamento fixo exige limite" });
    } else if (v.categoryId || v.limitCents != null) {
      ctx.addIssue({ code: "custom", message: "orçamento por bucket não tem categoria nem limite" });
    }
  });
export type BudgetUpsertInput = z.infer<typeof upsertBody>;

@Controller("budgets")
@UseGuards(CurrentUserGuard)
export class BudgetsController {
  constructor(private readonly service: BudgetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.workspaceId);
  }

  /** `asOf` (YYYY-MM-DD, hoje no fuso do navegador) define o mês apurado. */
  @Get("status")
  status(@CurrentUser() user: AuthenticatedUser, @Query("asOf") asOf?: string) {
    return this.service.status(user.workspaceId, asOf ? isoDateSchema.parse(asOf) : undefined);
  }

  @Post()
  @HttpCode(200)
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.upsert(user.workspaceId, upsertBody.parse(body));
  }

  @Delete(":id")
  @HttpCode(200)
  delete(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.delete(user.workspaceId, id);
  }
}
```

- [ ] **Step 4: Service**

Substituir `apps/api/src/budgets/budgets.service.ts` (o parâmetro `asOf` fica pronto para a Task 12; até lá o padrão é a data UTC de hoje):

```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";
import { reportableSql } from "../common/reportable";
import type { BudgetUpsertInput } from "./budgets.controller";

type Bucket = "needs" | "wants" | "savings";
const BUCKET_SHARE: Record<Bucket, number> = { needs: 0.5, wants: 0.3, savings: 0.2 };

export type BudgetStatusRow = {
  id: string;
  method: "fixed" | Bucket;
  categoryId: string | null;
  limitCents: number;
  spentCents: number;
  pct: number;
};

@Injectable()
export class BudgetsService {
  async list(workspaceId: string) {
    return prisma.budget.findMany({
      where: { workspaceId },
      select: { id: true, method: true, categoryId: true, limitCents: true, createdAt: true },
    });
  }

  async upsert(workspaceId: string, body: BudgetUpsertInput) {
    const categoryId = body.method === "fixed" ? body.categoryId! : null;
    if (categoryId) {
      const cat = await prisma.category.findFirst({ where: { id: categoryId, workspaceId }, select: { type: true } });
      if (!cat) throw new BadRequestException("categoria inexistente no workspace");
      if (cat.type !== "expense") throw new BadRequestException("orçamento só para categoria de despesa");
    }
    const limitCents = body.method === "fixed" ? BigInt(body.limitCents!) : null;

    const existing = await prisma.budget.findFirst({
      where: { workspaceId, method: body.method, categoryId },
      select: { id: true },
    });
    const select = { id: true, method: true, categoryId: true, limitCents: true };
    if (existing) return prisma.budget.update({ where: { id: existing.id }, data: { limitCents }, select });
    return prisma.budget.create({ data: { workspaceId, method: body.method, categoryId, limitCents }, select });
  }

  async delete(workspaceId: string, id: string) {
    const budget = await prisma.budget.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!budget) throw new NotFoundException("orçamento não encontrado");
    await prisma.budget.delete({ where: { id } });
    return { id };
  }

  /**
   * Apuração do mês de `asOf`. Buckets 50/30/20 usam a receita do mês como base; `needs` e `wants` ainda não
   * separam por categoria (o campo `Category.bucket` existe, mas não é preenchido), então ambos mostram a despesa total.
   * Um orçamento legado `fifty_thirty_twenty` vira três linhas (mesmo id) para a tela não o esconder.
   */
  async status(workspaceId: string, asOf: string = new Date().toISOString().slice(0, 10)): Promise<BudgetStatusRow[]> {
    const budgets = await prisma.budget.findMany({
      where: { workspaceId },
      select: { id: true, method: true, categoryId: true, limitCents: true },
    });
    if (!budgets.length) return [];

    const monthStart = `${asOf.slice(0, 7)}-01`;
    type SpendRow = { categoryId: string | null; total: bigint; incomeTotal: bigint };
    const spendRows = await prisma.$queryRaw<SpendRow[]>`
      SELECT "categoryId",
        SUM(CASE WHEN "type" = 'expense' THEN "amountCents" ELSE 0 END) AS total,
        SUM(CASE WHEN "type" = 'income' THEN "amountCents" ELSE 0 END) AS "incomeTotal"
      FROM transactions
      WHERE "workspaceId" = ${workspaceId}
        AND "date" >= ${monthStart}::date AND "date" <= ${asOf}::date
        ${reportableSql()}
      GROUP BY "categoryId"
    `;

    const spendByCat = new Map(spendRows.map((r) => [r.categoryId, Number(r.total)]));
    const totalIncome = spendRows.reduce((s, r) => s + Number(r.incomeTotal), 0);
    const totalExpenses = spendRows.reduce((s, r) => s + Number(r.total), 0);

    const bucketRow = (id: string, bucket: Bucket): BudgetStatusRow => {
      const limitCents = Math.round(totalIncome * BUCKET_SHARE[bucket]);
      const spentCents = bucket === "savings" ? Math.max(0, totalIncome - totalExpenses) : totalExpenses;
      return { id, method: bucket, categoryId: null, limitCents, spentCents, pct: limitCents > 0 ? Math.round((spentCents / limitCents) * 100) : 0 };
    };

    return budgets.flatMap((b): BudgetStatusRow[] => {
      if (b.method === "fixed") {
        const spentCents = b.categoryId ? (spendByCat.get(b.categoryId) ?? 0) : 0;
        const limitCents = Number(b.limitCents ?? 0);
        return [{ id: b.id, method: "fixed", categoryId: b.categoryId, limitCents, spentCents, pct: limitCents > 0 ? Math.round((spentCents / limitCents) * 100) : 0 }];
      }
      if (b.method === "fifty_thirty_twenty") return (["needs", "wants", "savings"] as Bucket[]).map((k) => bucketRow(b.id, k));
      return [bucketRow(b.id, b.method as Bucket)];
    });
  }
}
```

- [ ] **Step 5: Tela de orçamentos**

Em `apps/web/src/views/BudgetsView.vue`:

1. No `v-for` dos cards trocar `:key="b.id"` por `:key="`${b.id}:${b.method}`"`.
2. Mostrar o nome da categoria no card fixo e exigir categoria no formulário. Substituir o bloco `<script setup>` por:

```ts
import { ref, onMounted, computed } from "vue";
import { http } from "../lib/http";
import { api, type Category } from "../lib/api";
import { formatBRL } from "../lib/money";
import { localToday } from "../lib/dashboard-client";
import EmptyState from "../components/ui/EmptyState.vue";

interface BudgetStatus { id: string; method: "fixed" | "needs" | "wants" | "savings"; categoryId: string | null; limitCents: number; spentCents: number; pct: number }

const statuses = ref<BudgetStatus[]>([]);
const categories = ref<Category[]>([]);
const loading = ref(true);
const showForm = ref(false);
const erro = ref("");
const form = ref({ method: "fixed" as BudgetStatus["method"], categoryId: "", limitReais: 0 });

const canSave = computed(() => form.value.method !== "fixed" || (form.value.categoryId !== "" && form.value.limitReais > 0));

async function load() {
  loading.value = true;
  erro.value = "";
  try {
    statuses.value = await http<BudgetStatus[]>("GET", `/budgets/status?asOf=${localToday()}`);
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  erro.value = "";
  try {
    await http("POST", "/budgets", form.value.method === "fixed"
      ? { method: "fixed", categoryId: form.value.categoryId, limitCents: Math.round(form.value.limitReais * 100) }
      : { method: form.value.method });
    showForm.value = false;
    form.value = { method: "fixed", categoryId: "", limitReais: 0 };
    await load();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

async function deleteBudget(id: string) {
  erro.value = "";
  try {
    await http("DELETE", `/budgets/${id}`);
    await load();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

const fmt = formatBRL;

const LABEL: Record<string, string> = { fixed: "Fixo", needs: "Necessidades 50%", wants: "Desejos 30%", savings: "Poupança 20%" };
function labelFor(b: BudgetStatus) {
  if (b.method === "fixed") return `Fixo · ${categories.value.find((c) => c.id === b.categoryId)?.name ?? "categoria removida"}`;
  return LABEL[b.method] ?? b.method;
}

onMounted(async () => {
  try {
    categories.value = await api.categories.list("expense");
  } catch {
    /* nomes das categorias são secundários */
  }
  await load();
});
```

3. No template, trocar o campo de limite e acrescentar a categoria e o erro:

```vue
        <label v-if="form.method === 'fixed'">Categoria
          <select v-model="form.categoryId">
            <option value="">— Categoria —</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label v-if="form.method === 'fixed'">Limite (R$)
          <input v-model.number="form.limitReais" type="number" min="0" step="0.01" placeholder="0.00" />
        </label>
        <p v-if="erro" role="alert" class="text-error">{{ erro }}</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="showForm = false">Cancelar</button>
          <button type="button" class="btn-primary" :disabled="!canSave" @click="save">Salvar</button>
        </div>
```

e, acima da lista, `<p v-if="erro && !showForm" role="alert" class="text-error">{{ erro }}</p>`.

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/intelligence.e2e.test.ts && pnpm --filter @app/web typecheck && pnpm --filter @app/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma apps/api/src/budgets apps/web/src/views/BudgetsView.vue apps/api/test/e2e/intelligence.e2e.test.ts
git commit -m "fix(orcamentos): buckets 50/30/20 existem no enum, fixo exige categoria e status apura o mês de asOf

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Insights com tipos válidos (previsão e conta a vencer)

**Files:**
- Create: `prisma/migrations/20261002110000_insight_bill_due/migration.sql`
- Create: `apps/web/src/lib/insight-text.ts`, `apps/web/src/lib/__tests__/insight-text.test.ts`
- Modify: `prisma/schema.prisma` (enum `InsightType`), `apps/worker/src/insights/cashflow.processor.ts:47,54`, `apps/worker/src/reminders/reminders.processor.ts:33-47`, `apps/worker/test/reminders-processor.test.ts`, `apps/web/src/views/InsightsView.vue`

- [ ] **Step 1: Migration e schema**

Criar `prisma/migrations/20261002110000_insight_bill_due/migration.sql`:

```sql
-- Lembrete de conta a vencer tem tipo próprio (era gravado como budget_alert).
ALTER TYPE "InsightType" ADD VALUE 'bill_due';
```

Em `prisma/schema.prisma`, enum `InsightType` ganha `bill_due` ao final. Run: `pnpm exec prisma migrate deploy && pnpm exec prisma generate`.

- [ ] **Step 2: Teste do worker (falha primeiro)**

Em `apps/worker/test/reminders-processor.test.ts`, no primeiro teste, trocar `type: "budget_alert"` por `type: "bill_due"`. Run: `pnpm --filter @app/worker exec vitest run test/reminders-processor.test.ts` → FAIL.

- [ ] **Step 3: Worker**

Em `apps/worker/src/insights/cashflow.processor.ts`, trocar as duas ocorrências de `type: "cashflow_forecast" as never` por `type: "forecast"`.

Em `apps/worker/src/reminders/reminders.processor.ts`, trocar as duas ocorrências de `"budget_alert"` por `"bill_due"`.

Run: `pnpm --filter @app/worker test && pnpm --filter @app/worker typecheck` → PASS.

- [ ] **Step 4: Textos dos insights no web (teste)**

Criar `apps/web/src/lib/__tests__/insight-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insightDetail, insightIcon, insightTitle } from "../insight-text";

describe("insight-text", () => {
  it("conta a vencer", () => {
    const ins = { type: "bill_due", payload: { name: "Luz", amountCents: 12050, dueDate: "2026-10-05" } };
    expect(insightTitle(ins)).toBe("Conta a vencer: Luz");
    expect(insightDetail(ins)).toBe("R$ 120,50 vence em 05/10/2026");
    expect(insightIcon("bill_due")).toBe("📅");
  });
  it("previsão positiva e negativa", () => {
    expect(insightTitle({ type: "forecast", payload: { forecastBalanceCents: 100 } })).toBe("Previsão positiva este mês");
    expect(insightTitle({ type: "forecast", payload: { forecastBalanceCents: -100 } })).toBe("Atenção: déficit previsto");
    expect(insightDetail({ type: "forecast", payload: { forecastBalanceCents: -1500, narrative: null } })).toBe("Previsão: R$ 15,00");
  });
  it("tipo desconhecido não quebra", () => {
    expect(insightTitle({ type: "x", payload: {} })).toBe("x");
    expect(insightDetail({ type: "x", payload: {} })).toBe("");
  });
});
```

Run: `pnpm --filter @app/web exec vitest run src/lib/__tests__/insight-text.test.ts` → FAIL.

- [ ] **Step 5: Implementar**

Criar `apps/web/src/lib/insight-text.ts`:

```ts
import { formatBRL } from "./money";
import { formatDateOnly } from "./date";

export interface InsightLike { type: string; payload: Record<string, unknown> }

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function insightIcon(type: string): string {
  const map: Record<string, string> = { spike: "📈", subscription: "🔄", budget_alert: "⚠️", forecast: "🔮", bill_due: "📅" };
  return map[type] ?? "💡";
}

export function insightTitle(ins: InsightLike): string {
  const p = ins.payload;
  switch (ins.type) {
    case "spike": return `Gasto acima do normal em ${str(p.categoryName)}`;
    case "subscription": return `Assinatura detectada: ${str(p.counterparty)}`;
    case "budget_alert": return `Orçamento ${num(p.pct)}% utilizado`;
    case "forecast": return num(p.forecastBalanceCents) >= 0 ? "Previsão positiva este mês" : "Atenção: déficit previsto";
    case "bill_due": return `Conta a vencer: ${str(p.name)}`;
    default: return ins.type;
  }
}

export function insightDetail(ins: InsightLike): string {
  const p = ins.payload;
  switch (ins.type) {
    case "spike": return `${num(p.pctAboveAvg)}% acima da média (atual ${formatBRL(num(p.currentCents))} vs média ${formatBRL(num(p.avgCents))})`;
    case "subscription": return `Detectada por ${num(p.monthsDetected)} meses · média ${formatBRL(num(p.avgCents))}/mês`;
    case "budget_alert": return `${formatBRL(num(p.spentCents))} gastos de ${formatBRL(num(p.limitCents))} planejados`;
    case "forecast": return str(p.narrative) || `Previsão: ${formatBRL(Math.abs(num(p.forecastBalanceCents)))}`;
    case "bill_due": return `${formatBRL(num(p.amountCents))} vence em ${formatDateOnly(str(p.dueDate))}`;
    default: return "";
  }
}
```

Em `apps/web/src/views/InsightsView.vue`, apagar `iconFor`, `titleFor`, `detailFor` e o import de `formatBRL`; importar `{ insightDetail, insightIcon, insightTitle } from "../lib/insight-text"` e no template usar `insightIcon(ins.type)`, `insightTitle(ins)`, `insightDetail(ins)`.

Run: `pnpm --filter @app/web test && pnpm --filter @app/web typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma apps/worker/src/insights/cashflow.processor.ts apps/worker/src/reminders apps/worker/test/reminders-processor.test.ts apps/web/src/lib/insight-text.ts apps/web/src/lib/__tests__/insight-text.test.ts apps/web/src/views/InsightsView.vue
git commit -m "fix(insights): previsão usa o tipo forecast e lembrete de conta ganha o tipo bill_due

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Sessão do web sobrevive ao reload, 401 desloga, troca de workspace recarrega

**Files:**
- Modify: `apps/web/src/stores/auth.ts`, `apps/web/src/stores/workspace.ts`, `apps/web/src/lib/http.ts`, `apps/web/src/App.vue:96`
- Test: `apps/web/src/stores/__tests__/auth.test.ts`, `apps/web/src/lib/__tests__/http.test.ts`, create `apps/web/src/stores/__tests__/workspace.test.ts`

- [ ] **Step 1: Testes que falham**

Acrescentar em `auth.test.ts` (dentro do `describe`):

```ts
  it("token persiste no localStorage e volta numa nova instância do store", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "senha123!");
    setActivePinia(createPinia());
    const again = useAuthStore();
    expect(again.token).toBe("tok");
    expect(again.userId).toBe("u1");
  });

  it("expire limpa a sessão sem chamar o servidor", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "senha123!");
    store.expire();
    expect(store.token).toBeNull();
    expect(localStorage.getItem("auth-session")).toBeNull();
  });
```
e no `beforeEach` acrescentar `localStorage.clear();`.

Acrescentar em `http.test.ts`:

```ts
  it("401 encerra a sessão local e lança HttpError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));
    await expect(http("GET", "/accounts")).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore().token).toBeNull();
  });
```

Criar `apps/web/src/stores/__tests__/workspace.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

const httpMock = vi.fn();
vi.mock("../../lib/http", () => ({ http: httpMock }));

import { useWorkspaceStore } from "../workspace";
import { useAuthStore } from "../auth";

describe("workspace store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    httpMock.mockReset();
    useAuthStore().token = "tok";
  });

  it("setActive persiste e load respeita o id salvo", async () => {
    httpMock.mockResolvedValue([{ id: "w1", type: "personal", name: "P" }, { id: "w2", type: "family", name: "F" }]);
    const s = useWorkspaceStore();
    s.setActive("w2");
    expect(localStorage.getItem("workspace-active")).toBe("w2");
    setActivePinia(createPinia());
    useAuthStore().token = "tok";
    const again = useWorkspaceStore();
    await again.load();
    expect(again.activeId).toBe("w2");
  });

  it("id salvo que não existe mais cai no primeiro workspace", async () => {
    localStorage.setItem("workspace-active", "sumiu");
    httpMock.mockResolvedValue([{ id: "w1", type: "personal", name: "P" }]);
    const s = useWorkspaceStore();
    await s.load();
    expect(s.activeId).toBe("w1");
  });
});
```

Run: `pnpm --filter @app/web test` → os novos FALHAM.

- [ ] **Step 2: Store de auth com persistência**

Substituir `apps/web/src/stores/auth.ts`:

```ts
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { authClient } from "../lib/auth-client";

const STORAGE_KEY = "auth-session";

interface StoredSession { token: string; userId: string | null }

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof p.token !== "string" || !p.token) return null;
    return { token: p.token, userId: typeof p.userId === "string" ? p.userId : null };
  } catch {
    return null;
  }
}

function writeStored(session: StoredSession | null) {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* armazenamento indisponível: a sessão vale só nesta aba */
  }
}

export const useAuthStore = defineStore("auth", () => {
  const stored = readStored();
  const token = ref<string | null>(stored?.token ?? null);
  const userId = ref<string | null>(stored?.userId ?? null);
  const isAuthenticated = computed(() => !!token.value);

  async function signIn(email: string, password: string) {
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) throw error;
    const d = data as { session?: { token?: string }; token?: string; user?: { id?: string } } | null;
    token.value = d?.session?.token ?? d?.token ?? null;
    userId.value = d?.user?.id ?? null;
    writeStored(token.value ? { token: token.value, userId: userId.value } : null);
  }

  async function signUp(email: string, password: string, name: string) {
    const { error } = await authClient.signUp.email({ email, password, name });
    if (error) throw error;
  }

  /** Sessão inválida no servidor (401): limpa localmente sem chamar o servidor. */
  function expire() {
    token.value = null;
    userId.value = null;
    writeStored(null);
  }

  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      expire();
    }
  }

  return { token, userId, isAuthenticated, signIn, signUp, signOut, expire };
});
```

- [ ] **Step 3: http trata 401**

Em `apps/web/src/lib/http.ts`, trocar a linha `if (!res.ok) throw new HttpError(...)` por:

```ts
  if (res.status === 401) useAuthStore().expire();
  if (!res.ok) throw new HttpError(res.status, messageFrom(text), text);
```

- [ ] **Step 4: Workspace ativo persistente**

Substituir `apps/web/src/stores/workspace.ts`:

```ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./auth";
import { http } from "../lib/http";

export interface WorkspaceInfo {
  id: string;
  type: string;
  name: string;
  currency: string;
}

const STORAGE_KEY = "workspace-active";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* sem armazenamento: vale só nesta aba */
  }
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<WorkspaceInfo[]>([]);
  const activeId = ref<string | null>(readStored());
  const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) ?? workspaces.value[0] ?? null);

  async function load() {
    const auth = useAuthStore();
    if (!auth.token) return;
    workspaces.value = await http<WorkspaceInfo[]>("GET", "/workspaces");
    // id salvo que não existe mais (removido do workspace, outro usuário no mesmo navegador) cai no primeiro
    if (!workspaces.value.some((w) => w.id === activeId.value)) {
      setActive(workspaces.value[0]?.id ?? null);
    }
  }

  function setActive(id: string | null) {
    activeId.value = id;
    writeStored(id);
  }

  async function createWorkspace(type: string, name: string) {
    const ws = await http<WorkspaceInfo>("POST", "/workspaces", { type, name });
    workspaces.value.push(ws);
    return ws;
  }

  return { workspaces, activeId, active, load, setActive, createWorkspace };
});
```

- [ ] **Step 5: Remontar a tela ao trocar de workspace**

Em `apps/web/src/App.vue`, dentro de `<main class="main">`, trocar `<RouterView />` por `<RouterView :key="wsStore.activeId ?? ''" />`.

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @app/web test && pnpm --filter @app/web typecheck` → PASS. Se `login-view.test.ts` ou `boot.test.ts` quebrarem por causa do `localStorage`, acrescentar `localStorage.clear()` no `beforeEach` deles.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/stores apps/web/src/lib/http.ts apps/web/src/lib/__tests__/http.test.ts apps/web/src/App.vue
git commit -m "fix(web): sessão e workspace ativo persistem, 401 encerra a sessão e trocar de workspace remonta a tela

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Web: permissão de membros, chat sem HTML cru, remoção do módulo offline

**Files:**
- Create: `apps/web/src/lib/members.ts`, `apps/web/src/lib/__tests__/members.test.ts`, `apps/web/src/lib/chat-format.ts`, `apps/web/src/lib/__tests__/chat-format.test.ts`
- Modify: `apps/web/src/views/MembersView.vue:149-152`, `apps/web/src/views/ChatView.vue:570-572`, `apps/web/index.html:7`, `apps/web/package.json`
- Delete: `apps/web/src/offline/` (inclui `__tests__/offline.test.ts`)

- [ ] **Step 1: Testes**

`apps/web/src/lib/__tests__/members.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canManageMembers } from "../members";

const members = [
  { role: "owner", user: { id: "u1" } },
  { role: "viewer", user: { id: "u2" } },
];

describe("canManageMembers", () => {
  it("owner e admin podem; viewer não; sem usuário não", () => {
    expect(canManageMembers(members, "u1")).toBe(true);
    expect(canManageMembers(members, "u2")).toBe(false);
    expect(canManageMembers(members, null)).toBe(false);
    expect(canManageMembers([{ role: "admin", user: { id: "u3" } }], "u3")).toBe(true);
  });
});
```

`apps/web/src/lib/__tests__/chat-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeHtml, formatChatText } from "../chat-format";

describe("chat-format", () => {
  it("escapa HTML vindo do modelo", () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
  it("mantém negrito e quebras de linha", () => {
    expect(formatChatText("Saldo: **R$ 10**\nok")).toBe("Saldo: <strong>R$ 10</strong><br>ok");
  });
  it("não deixa tag passar dentro do negrito", () => {
    expect(formatChatText("**<b>x</b>**")).toBe("<strong>&lt;b&gt;x&lt;/b&gt;</strong>");
  });
});
```

Run: `pnpm --filter @app/web test` → FAIL (módulos inexistentes).

- [ ] **Step 2: Implementar as libs**

`apps/web/src/lib/members.ts`:

```ts
/** O usuário atual pode gerenciar membros (owner ou admin) neste workspace. */
export function canManageMembers(members: Array<{ role: string; user: { id: string } }>, userId: string | null): boolean {
  if (!userId) return false;
  const me = members.find((m) => m.user.id === userId);
  return me?.role === "owner" || me?.role === "admin";
}
```

`apps/web/src/lib/chat-format.ts`:

```ts
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Texto do modelo → HTML seguro: escapa tudo e só então aplica negrito (`**x**`) e quebras de linha. */
export function formatChatText(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
```

- [ ] **Step 3: Usar nas views**

`MembersView.vue`: importar `useAuthStore` de `../stores/auth` e `canManageMembers` de `../lib/members`; `const auth = useAuthStore();` e trocar o `canManage`:

```ts
const canManage = computed(() => canManageMembers(members.value, auth.userId));
```

`ChatView.vue`: importar `{ formatChatText } from "../lib/chat-format"`, trocar `v-html="formatText(msg.content)"` por `v-html="formatChatText(msg.content)"` e apagar a função `formatText`.

- [ ] **Step 4: Remover o módulo offline e o CSS duplicado**

Run: `grep -rn "offline/" apps/web/src --include='*.ts' --include='*.vue' | grep -v "src/offline/"`
Expected: nenhuma linha (ninguém importa). Então:

```bash
git rm -r apps/web/src/offline
```

Em `apps/web/package.json`, remover `"idb"` de `dependencies` e `"fake-indexeddb"` de `devDependencies`; rodar `pnpm install` na raiz (atualiza `pnpm-lock.yaml`).

Em `apps/web/index.html`, apagar a linha `<link rel="stylesheet" href="/src/styles/tokens.css" />` (o `main.ts` já importa o CSS).

- [ ] **Step 5: Rodar**

Run: `pnpm --filter @app/web test && pnpm --filter @app/web typecheck && pnpm --filter @app/web build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web pnpm-lock.yaml
git commit -m "fix(web): permissão de membros pelo usuário atual, chat escapa HTML, remove módulo offline sem uso

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `storagePath` preso ao workspace

**Files:**
- Create: `apps/api/src/storage/storage-path.ts`, `apps/api/test/unit/storage-path.test.ts`
- Modify: `apps/api/src/ingest/ingest.service.ts:31-43`, `apps/api/src/import/import.service.ts:210`
- Test: `apps/api/test/e2e/ingest.e2e.test.ts` (TI3)

- [ ] **Step 1: Teste unitário**

`apps/api/test/unit/storage-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { assertWorkspacePath, belongsToWorkspace } from "../../src/storage/storage-path";

describe("storage-path", () => {
  it("aceita só chaves do próprio workspace", () => {
    expect(belongsToWorkspace("ws1/abc.jpg", "ws1")).toBe(true);
    expect(belongsToWorkspace("ws2/abc.jpg", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws1", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws1/", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws1/../ws2/abc.jpg", "ws1")).toBe(false);
    expect(belongsToWorkspace("/ws1/abc.jpg", "ws1")).toBe(false);
    expect(belongsToWorkspace("ws10/abc.jpg", "ws1")).toBe(false);
  });
  it("assert lança 400", () => {
    expect(() => assertWorkspacePath("ws2/x.jpg", "ws1")).toThrow(BadRequestException);
    expect(() => assertWorkspacePath("ws1/x.jpg", "ws1")).not.toThrow();
  });
});
```

Run: `pnpm --filter @app/api exec vitest run test/unit/storage-path.test.ts` → FAIL.

- [ ] **Step 2: Implementar**

`apps/api/src/storage/storage-path.ts`:

```ts
import { BadRequestException } from "@nestjs/common";

/** Chave S3 gerada por `IngestService.getUploadUrl`: `${workspaceId}/${uuid}.${ext}`. */
export function belongsToWorkspace(storagePath: string, workspaceId: string): boolean {
  if (!storagePath || storagePath.startsWith("/") || storagePath.includes("..") || storagePath.includes("//")) return false;
  const prefix = `${workspaceId}/`;
  return storagePath.startsWith(prefix) && storagePath.length > prefix.length;
}

export function assertWorkspacePath(storagePath: string, workspaceId: string): void {
  if (!belongsToWorkspace(storagePath, workspaceId)) throw new BadRequestException("arquivo não pertence a este workspace");
}
```

Em `ingest.service.ts`, no início de `enqueueFile`: `assertWorkspacePath(storagePath, workspaceId);` (importar de `../storage/storage-path`).
Em `import.service.ts`, no início de `enqueuePdf`: `assertWorkspacePath(storagePath, workspaceId);`.

- [ ] **Step 3: Ajustar o teste TI3**

Em `apps/api/test/e2e/ingest.e2e.test.ts`, teste TI3: antes do `POST /ingest/image`, obter uma chave válida e usar outra inválida:

```ts
    const up = await app.inject({ method: "POST", url: "/ingest/upload-url", headers: h, payload: { ext: "jpg", contentType: "image/jpeg" } });
    const storagePath = up.json().storagePath as string;

    const alheio = await app.inject({ method: "POST", url: "/ingest/image", headers: h, payload: { storagePath: "fake-ws/some-file.jpg" } });
    expect(alheio.statusCode).toBe(400);

    const res = await app.inject({ method: "POST", url: "/ingest/image", headers: h, payload: { storagePath } });
```
(o restante do teste continua igual).

Run: `pnpm --filter @app/api exec vitest run test/unit/storage-path.test.ts test/e2e/ingest.e2e.test.ts test/e2e/import.e2e.test.ts` → PASS. Se `import.e2e.test.ts` usar um `storagePath` fixo em `POST /import/pdf`, trocar por `${workspaceId}/arquivo.pdf` (o workspace vem de `prisma.workspace.findFirst({ where: { createdById } })`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/storage/storage-path.ts apps/api/src/ingest apps/api/src/import/import.service.ts apps/api/test
git commit -m "fix(ingest): storagePath precisa pertencer ao workspace da requisição

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Commit de importação só em lote `preview` e na conta do lote

**Files:**
- Modify: `apps/api/src/import/import.service.ts:81-100,165-174`
- Test: `apps/api/test/e2e/import-statements.e2e.test.ts`

- [ ] **Step 1: Testes**

Acrescentar ao `describe("Fase 11 — POST /import/preview e commit (extrato C6)")`:

```ts
  it("confirmar o mesmo lote duas vezes responde 409 e não insere nada", async () => {
    const u = await newUser("recommit");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId);
    const first = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(first.statusCode).toBe(200);
    const again = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(again.statusCode).toBe(409);
    expect(await prisma.transaction.count({ where: { importBatchId: body.batchId } })).toBe(first.json().inserted);
  });

  it("linhas de outra conta do mesmo workspace são recusadas (400)", async () => {
    const u = await newUser("outraconta");
    const accountId = await newAccount(u);
    const other = await newAccount(u, { name: "Outra" });
    const body = await previewC6(u, accountId);
    const res = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, other));
    expect(res.statusCode).toBe(400);
  });
```

Run: `pnpm --filter @app/api exec vitest run test/e2e/import-statements.e2e.test.ts -t "409|outra conta"` → FAIL.

- [ ] **Step 2: Implementar**

Em `import.service.ts`, método `commit`, trocar o bloco inicial de busca do lote por:

```ts
    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, workspaceId },
      select: { id: true, status: true, undoneAt: true, accountId: true },
    });
    if (!batch) throw new NotFoundException("lote não encontrado");
    // lote desfeito não volta a ser gravado: as linhas ficariam órfãs (undoneAt fica marcado e novo undo dá 409)
    if (batch.undoneAt) throw new ConflictException("o lote foi desfeito; gere um novo preview");
    if (batch.status !== "preview") throw new ConflictException("o lote já foi confirmado");
    if (batch.accountId && rows.some((r) => r.accountId !== batch.accountId)) {
      throw new BadRequestException("as linhas devem ser da conta escolhida no preview");
    }
```

e, dentro da transação, a troca condicional de status passa a exigir `preview`:

```ts
      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, workspaceId, undoneAt: null, status: "preview" },
        data: { status: "committed" },
      });
      if (claimed.count === 0) throw new ConflictException("o lote já foi confirmado ou desfeito; gere um novo preview");
```

- [ ] **Step 3: Rodar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/import-statements.e2e.test.ts test/e2e/import.e2e.test.ts test/e2e/fatura-cartao.e2e.test.ts test/e2e/integridade-importacao.e2e.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/import/import.service.ts apps/api/test/e2e/import-statements.e2e.test.ts
git commit -m "fix(import): commit exige lote em preview e linhas da conta do lote

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Guardas de entidade e da categoria pega-tudo

**Files:**
- Modify: `apps/api/src/categories/categories.service.ts:33-46`, `apps/api/src/accounts/accounts.service.ts:62-69`
- Create: `apps/api/test/e2e/guardas-entidade.e2e.test.ts`

- [ ] **Step 1: Teste**

```ts
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";

let app: NestFastifyApplication;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

async function newUser(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  return { userId: u!.user.id, workspaceId: ws.id, h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" } };
}

describe("Guardas de entidade e pega-tudo", () => {
  it("categoria pega-tudo do sistema não pode ser renomeada", async () => {
    const u = await newUser("catchall");
    const cat = await prisma.category.findFirstOrThrow({ where: { workspaceId: u.workspaceId, name: "Outras despesas" } });
    const res = await app.inject({ method: "PATCH", url: `/categories/${cat.id}`, headers: u.h, payload: { name: "Diversos" } });
    expect(res.statusCode).toBe(400);
    const cor = await app.inject({ method: "PATCH", url: `/categories/${cat.id}`, headers: u.h, payload: { color: "#333" } });
    expect(cor.statusCode).toBe(200);
  });

  it("categoria não vira exclusiva de uma entidade enquanto a outra a usa (409)", async () => {
    const u = await newUser("catent");
    const pf = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "PF", entity: "pf" } });
    const cat = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Software" } });
    await app.inject({
      method: "POST", url: "/transactions", headers: u.h,
      payload: { type: "expense", amountCents: 1000, date: "2026-10-01", accountId: pf.json().id, categoryId: cat.json().id },
    });
    const toPj = await app.inject({ method: "PATCH", url: `/categories/${cat.json().id}`, headers: u.h, payload: { entity: "pj" } });
    expect(toPj.statusCode).toBe(409);
    const toPf = await app.inject({ method: "PATCH", url: `/categories/${cat.json().id}`, headers: u.h, payload: { entity: "pf" } });
    expect(toPf.statusCode).toBe(200);
  });

  it("conta não muda de entidade enquanto tem lançamentos em categoria exclusiva da entidade atual (409)", async () => {
    const u = await newUser("accent");
    const pj = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "PJ", entity: "pj" } });
    const cat = await prisma.category.findFirstOrThrow({ where: { workspaceId: u.workspaceId, name: "Fornecedores" } }); // entity pj
    await app.inject({
      method: "POST", url: "/transactions", headers: u.h,
      payload: { type: "expense", amountCents: 1000, date: "2026-10-01", accountId: pj.json().id, categoryId: cat.id },
    });
    const res = await app.inject({ method: "PATCH", url: `/accounts/${pj.json().id}`, headers: u.h, payload: { entity: "pf" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/1 lançamento/);
  });
});
```

Run: `pnpm --filter @app/api exec vitest run test/e2e/guardas-entidade.e2e.test.ts` → FAIL.

- [ ] **Step 2: Categorias**

Em `categories.service.ts`, importar `BadRequestException, ConflictException` de `@nestjs/common` e `foldText, isCatchAllCategoryName` de `@app/shared`; substituir `update`:

```ts
  async update(workspaceId: string, id: string, dto: Partial<CategoryInput>) {
    const existing = await prisma.category.findFirst({ where: { id, workspaceId }, select: { name: true, isSystem: true, entity: true } });
    if (!existing) throw new NotFoundException();

    if (dto.name && existing.isSystem && isCatchAllCategoryName(existing.name) && foldText(dto.name.trim()) !== foldText(existing.name)) {
      throw new BadRequestException("esta é a categoria pega-tudo do sistema e não pode ser renomeada");
    }
    if (dto.entity && dto.entity !== existing.entity && dto.entity !== "both") {
      const other = dto.entity === "pf" ? "pj" : "pf";
      const conflicting = await prisma.transaction.count({ where: { workspaceId, categoryId: id, account: { entity: other } } });
      if (conflicting > 0) {
        throw new ConflictException(`${conflicting} lançamento(s) de contas ${other.toUpperCase()} usam esta categoria; recategorize-os antes`);
      }
    }

    return prisma.category.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.entity ? { entity: dto.entity } : {}),
      },
      select: CATEGORY_SELECT,
    });
  }
```

- [ ] **Step 3: Contas**

Em `accounts.service.ts`, substituir `update`:

```ts
  async update(workspaceId: string, id: string, dto: AccountUpdateInput) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId }, select: { type: true, entity: true } });
    if (!existing) throw new NotFoundException();
    if (existing.type !== "credit_card" && cardFieldsPresent(dto)) {
      throw new BadRequestException("closingDay, dueDay e creditLimitCents só valem para cartão de crédito");
    }
    if (dto.entity && dto.entity !== existing.entity) {
      // categorias exclusivas da entidade atual deixariam de servir aos lançamentos desta conta
      const conflicting = await prisma.transaction.count({ where: { workspaceId, accountId: id, category: { entity: existing.entity } } });
      if (conflicting > 0) {
        throw new ConflictException(`${conflicting} lançamento(s) desta conta usam categorias ${existing.entity.toUpperCase()}; recategorize-os antes de trocar a entidade`);
      }
    }
    return prisma.bankAccount.update({ where: { id }, data: dto, select: ACCOUNT_SELECT });
  }
```
(`ConflictException` já está importado nesse arquivo.)

- [ ] **Step 4: Rodar**

Run: `pnpm --filter @app/api exec vitest run test/e2e/guardas-entidade.e2e.test.ts test/e2e/modelo-pf-pj.e2e.test.ts test/e2e/finance.e2e.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/categories/categories.service.ts apps/api/src/accounts/accounts.service.ts apps/api/test/e2e/guardas-entidade.e2e.test.ts
git commit -m "fix(categorias): pega-tudo não é renomeada e entidade só muda sem lançamentos incompatíveis

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: "Hoje" no fuso do usuário (orçamentos e insights do worker)

**Files:**
- Create: `packages/shared/src/time.ts`, `packages/shared/src/__tests__/time.test.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/budgets/budgets.service.ts` (padrão de `asOf`), `apps/worker/src/insights/compute.processor.ts`, `apps/worker/src/insights/cashflow.processor.ts`, `.env.example`

**Interfaces:**
- Produces: `todayInTimeZone(timeZone?: string, now?: Date): string` (`YYYY-MM-DD`), `monthStartOf(iso: string): string`, `DEFAULT_TIME_ZONE = "America/Sao_Paulo"`, exportados de `@app/shared`.

- [ ] **Step 1: Teste**

`packages/shared/src/__tests__/time.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, monthStartOf, todayInTimeZone } from "../time";

describe("time", () => {
  it("01:30 UTC ainda é o dia anterior em São Paulo", () => {
    const now = new Date("2026-10-01T01:30:00Z");
    expect(todayInTimeZone("America/Sao_Paulo", now)).toBe("2026-09-30");
    expect(todayInTimeZone("UTC", now)).toBe("2026-10-01");
  });
  it("padrão é São Paulo e fuso inválido cai no padrão", () => {
    const now = new Date("2026-03-01T02:00:00Z");
    expect(todayInTimeZone(undefined, now)).toBe("2026-02-28");
    expect(todayInTimeZone("Marte/Olympus", now)).toBe(todayInTimeZone(DEFAULT_TIME_ZONE, now));
  });
  it("monthStartOf", () => {
    expect(monthStartOf("2026-09-30")).toBe("2026-09-01");
  });
});
```

Run: `pnpm --filter @app/shared exec vitest run src/__tests__/time.test.ts` → FAIL.

- [ ] **Step 2: Implementar**

`packages/shared/src/time.ts`:

```ts
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  }
}

/** Data civil (`YYYY-MM-DD`) de `now` no fuso dado; fuso vazio ou inválido usa o padrão (Brasil). */
export function todayInTimeZone(timeZone: string | undefined = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  const parts = formatter(timeZone?.trim() || DEFAULT_TIME_ZONE).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function monthStartOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
```

Em `packages/shared/src/index.ts`, acrescentar `export * from "./time";`.

- [ ] **Step 3: API**

Em `budgets.service.ts`: importar `{ monthStartOf, todayInTimeZone } from "@app/shared"`; a assinatura passa a `async status(workspaceId: string, asOf: string = todayInTimeZone(process.env["APP_TIMEZONE"]))` e `const monthStart = monthStartOf(asOf);`.

- [ ] **Step 4: Worker**

Em `apps/worker/src/insights/compute.processor.ts`, importar `{ addMonths, monthStartOf, todayInTimeZone } from "@app/shared"`. Em `computeInsights`:

```ts
export async function computeInsights(data: { workspaceId: string }) {
  const { workspaceId } = data;
  const today = todayInTimeZone(process.env["APP_TIMEZONE"]);
  const period = today.slice(0, 7); // "YYYY-MM"
  const monthStart = monthStartOf(today);

  await detectSpikes(workspaceId, period, today, monthStart);
  await detectSubscriptions(workspaceId, period, today);
  await detectBudgetAlerts(workspaceId, period, today, monthStart);
}
```

e nas três funções trocar as referências a `NOW()`:
- `detectSpikes(workspaceId, period, today, monthStart)`: `AND t."date" >= ${addMonths(monthStart.slice(0, 7), -4) + "-01"}::date AND t."date" <= ${today}::date`; `WHERE month = ${monthStart}::date` e `WHERE month < ${monthStart}::date`.
- `detectSubscriptions(workspaceId, period, today)`: `AND t."date" >= ${addMonths(today.slice(0, 7), -6) + "-01"}::date AND t."date" <= ${today}::date`.
- `detectBudgetAlerts(workspaceId, period, today, monthStart)`: `AND "date" >= ${monthStart}::date AND "date" <= ${today}::date`.

Em `apps/worker/src/insights/cashflow.processor.ts`, importar `{ addMonths, monthStartOf, todayInTimeZone } from "@app/shared"` e trocar:

```ts
  const today = todayInTimeZone(process.env["APP_TIMEZONE"]);
  const monthStart = monthStartOf(today);
  const from = addMonths(monthStart.slice(0, 7), -3) + "-01";
  const rows = await prisma.$queryRaw<MonthRow[]>`
    SELECT
      DATE_TRUNC('month', "date") AS month,
      SUM(CASE WHEN "type" = 'income' THEN "amountCents" ELSE 0 END) AS income,
      SUM(CASE WHEN "type" = 'expense' THEN "amountCents" ELSE 0 END) AS expenses
    FROM transactions
    WHERE "workspaceId" = ${workspaceId}
      AND "date" >= ${from}::date
      AND "date" < ${monthStart}::date
      ${reportableSql()}
    GROUP BY 1
    ORDER BY 1 ASC
  `;
```
e `const period = today.slice(0, 7);`.

Em `.env.example`, após `PORT=3100`:

```dotenv
# Fuso usado para "hoje" e "mês atual" no servidor (orçamentos, insights). Padrão America/Sao_Paulo.
# APP_TIMEZONE=America/Sao_Paulo
```

- [ ] **Step 5: Rodar**

Run: `pnpm --filter @app/shared test && pnpm turbo typecheck && pnpm --filter @app/worker test && pnpm --filter @app/api exec vitest run test/e2e/intelligence.e2e.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src apps/api/src/budgets/budgets.service.ts apps/worker/src/insights .env.example
git commit -m "fix(fuso): orçamentos e insights apuram o mês no fuso do usuário (APP_TIMEZONE), não em UTC

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Worker: mascarar PII na ingestão, MIME correto, assinaturas sem caixa, push expirado

**Files:**
- Create: `apps/worker/src/ai/mime.ts`, `apps/worker/test/mime.test.ts`
- Modify: `apps/worker/src/ai/openrouter.ts:59-68,88-118`, `apps/worker/src/ai/ingest.processor.ts:60-70`, `apps/worker/src/insights/compute.processor.ts` (assinaturas), `apps/worker/src/reminders/reminders.processor.ts:49-57`, `apps/worker/test/reminders-processor.test.ts`

- [ ] **Step 1: Testes**

`apps/worker/test/mime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mimeFromPath } from "../src/ai/mime";

describe("mimeFromPath", () => {
  it("imagens", () => {
    expect(mimeFromPath("ws/a.jpg", "image")).toBe("image/jpeg");
    expect(mimeFromPath("ws/a.PNG", "image")).toBe("image/png");
    expect(mimeFromPath("ws/a.heic", "image")).toBe("image/heic");
    expect(mimeFromPath("ws/a", "image")).toBe("image/jpeg");
  });
  it("áudios", () => {
    expect(mimeFromPath("ws/a.webm", "audio")).toBe("audio/webm");
    expect(mimeFromPath("ws/a.m4a", "audio")).toBe("audio/mp4");
    expect(mimeFromPath("ws/a.mp3", "audio")).toBe("audio/mpeg");
    expect(mimeFromPath("ws/a.xyz", "audio")).toBe("audio/webm");
  });
});
```

Em `reminders-processor.test.ts`, no mock do prisma acrescentar `pushSubscription: { findMany: db.findSubs, delete: db.deleteSub }` com `deleteSub: vi.fn()` em `db` (e `db.deleteSub.mockReset()` no `beforeEach`), e um teste novo:

```ts
  it("inscrição expirada (410) é apagada; outras falhas não derrubam o job", async () => {
    const today = new Date();
    db.findBills.mockResolvedValue([{ id: "b1", name: "Luz", amountCents: 10000n, dueDate: today, workspaceId: "ws1" }]);
    db.findSubs.mockResolvedValue([{ id: "s1", endpoint: "e", p256dh: "p", auth: "a" }]);
    db.deleteSub.mockResolvedValue({});
    const gone = Object.assign(new Error("Gone"), { statusCode: 410 });
    registerRemindersWorker({} as never, vi.fn().mockRejectedValue(gone));
    await captured.processor!();
    expect(db.deleteSub).toHaveBeenCalledWith({ where: { id: "s1" } });

    db.deleteSub.mockClear();
    registerRemindersWorker({} as never, vi.fn().mockRejectedValue(new Error("rede")));
    await captured.processor!();
    expect(db.deleteSub).not.toHaveBeenCalled();
  });
```

Run: `pnpm --filter @app/worker test` → FAIL (mime inexistente; delete não chamado).

- [ ] **Step 2: MIME**

`apps/worker/src/ai/mime.ts`:

```ts
const IMAGE: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif" };
const AUDIO: Record<string, string> = { webm: "audio/webm", m4a: "audio/mp4", mp4: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };

/** Tipo MIME pela extensão da chave S3; sem extensão conhecida usa o padrão do navegador (jpeg / webm). */
export function mimeFromPath(storagePath: string, kind: "image" | "audio"): string {
  const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "image") return IMAGE[ext] ?? "image/jpeg";
  return AUDIO[ext] ?? "audio/webm";
}
```

Em `ingest.processor.ts`, importar `mimeFromPath` e trocar:

```ts
        } else if (kind === "parse_image") {
          const bytes = await downloadFromS3(deps.s3, deps.s3Bucket, storagePath!);
          const dataUrl = `data:${mimeFromPath(storagePath!, "image")};base64,${Buffer.from(bytes).toString("base64")}`;
          result = await deps.ai.parseImage(dataUrl);
        } else {
          // parse_audio
          const bytes = await downloadFromS3(deps.s3, deps.s3Bucket, storagePath!);
          const blob = new Blob([Buffer.from(bytes)], { type: mimeFromPath(storagePath!, "audio") });
          const transcript = await deps.stt.transcribe(blob);
          result = await deps.ai.parseText(transcript);
        }
```

- [ ] **Step 3: Mascarar antes do LLM**

Em `openrouter.ts`, importar `redactForLlm` de `@app/shared` e:

```ts
  parseText(text: string) {
    return this.call(this.textModel, redactForLlm(text));
  }
```
e em `parseInvoiceText`, `{ role: "user", content: redactForLlm(text) }`.

- [ ] **Step 4: Assinaturas sem caixa**

Em `compute.processor.ts`, `detectSubscriptions`: a consulta passa a agrupar por `LOWER(TRIM(t."counterparty"))`:

```ts
    SELECT
      LOWER(TRIM(t."counterparty")) AS "counterparty",
      COUNT(DISTINCT DATE_TRUNC('month', t."date")) AS months,
      AVG(t."amountCents") AS "avgCents"
    FROM transactions t
    WHERE ...
      AND NULLIF(TRIM(t."counterparty"), '') IS NOT NULL
    GROUP BY LOWER(TRIM(t."counterparty"))
```
(mantendo os demais filtros e o `HAVING`). O `dedupKey` continua `sub:${row.counterparty}` (já em minúsculas).

- [ ] **Step 5: Push expirado**

Em `reminders.processor.ts`, mover a busca de inscrições para fora do loop de contas e tratar 404/410:

```ts
      for (const [workspaceId, bills] of byWs) {
        const subs = await prisma.pushSubscription.findMany({ where: { workspaceId } });
        for (const bill of bills) {
          const fmt = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
          const period = today.toISOString().slice(0, 10);
          const dedupKey = `bill:${bill.id}`;
          await prisma.insight.upsert({
            where: { workspaceId_type_dedupKey_period: { workspaceId, type: "bill_due", dedupKey, period } },
            update: {},
            create: {
              workspaceId,
              type: "bill_due",
              dedupKey,
              period,
              payload: { billId: bill.id, name: bill.name, amountCents: Number(bill.amountCents), dueDate: bill.dueDate.toISOString().slice(0, 10) },
            },
          });

          for (const sub of subs) {
            try {
              await sendPushFn(sub as SubInfo, { title: "Conta a vencer", body: `${bill.name} — ${fmt(Number(bill.amountCents))} vence em breve`, url: "/" });
            } catch (err) {
              // 404/410: o navegador cancelou a inscrição; apagar evita tentar para sempre
              const code = (err as { statusCode?: number }).statusCode;
              if (code === 404 || code === 410) await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
            }
          }
        }
      }
```

- [ ] **Step 6: Rodar**

Run: `pnpm --filter @app/worker test && pnpm --filter @app/worker typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src apps/worker/test
git commit -m "fix(worker): mascara PII na ingestão, MIME pela extensão, assinaturas sem caixa e remove push expirado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Miscelânea (chat, previews antigos, saldos entre membros, OFX, CI)

**Files:**
- Modify: `apps/api/src/chat/chat.service.ts:32-57`, `apps/api/src/import/import-statement.service.ts` (antes de criar o batch em `preview`), `apps/api/src/import/import.service.ts` (idem em `csvPreview`), `apps/api/src/splits/splits.service.ts:25-51`, `packages/shared/src/ofx.ts`, `packages/shared/src/__tests__/ofx.test.ts`, `.github/workflows/ci.yml:5`

- [ ] **Step 1: Teste do OFX**

Acrescentar em `packages/shared/src/__tests__/ofx.test.ts`:

```ts
  it("decodifica entidades HTML/SGML do MEMO", () => {
    const txt = `<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105<TRNAMT>-10.00<FITID>1<MEMO>Padaria &amp; Cia &#39;Centro&#39; &lt;SP&gt;</STMTTRN></OFX>`;
    expect(parseOfx(txt)[0].memo).toBe("Padaria & Cia 'Centro' <SP>");
  });
```
Run: `pnpm --filter @app/shared exec vitest run src/__tests__/ofx.test.ts` → FAIL.

- [ ] **Step 2: OFX**

Em `packages/shared/src/ofx.ts`, acrescentar antes de `parseOfx`:

```ts
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** OFX em SGML/XML escapa `&`, `<`, `>` e aspas; bancos também mandam `&#39;`. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
```
e em `parseOfx`: `memo: decodeEntities(tag(b, "MEMO") ?? tag(b, "NAME") ?? "") || null`.

- [ ] **Step 3: Chat**

Em `chat.service.ts`, método `send`: gravar a mensagem do usuário antes de chamar o modelo e limitar o histórico:

```ts
const HISTORY_LIMIT = 40;
```
(no topo, junto a `MODEL`) e no corpo:

```ts
    // grava a pergunta antes de chamar o modelo: uma falha do provedor não a perde
    await prisma.chatMessage.create({ data: { conversationId: conversation.id, role: "user", content: message } });

    const priorMessages = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    });
    const history = priorMessages.reverse().map((m) => ({ role: m.role, content: m.content }));

    const ctx = { workspaceId };
    const { answer, toolResults } = await runChat(this.apiKey, MODEL, history, ctx, this.fetchFn);

    const chartSpec = buildChart(toolResults);

    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: answer,
        toolResults: toolResults.length ? (toolResults as object[]) : undefined,
        chartSpec: chartSpec ? (chartSpec as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
```
(remover a antiga montagem de `history` com `{ role: "user", content: message }` e o `create` da mensagem do usuário que vinha depois).

- [ ] **Step 4: Previews antigos**

Criar em `apps/api/src/import/import-statement.service.ts` um método público e chamá-lo no início de `preview` (após validar a conta) e, em `import.service.ts`, no início de `csvPreview` (via `prisma` direto, para não criar dependência circular):

```ts
const STALE_PREVIEW_MS = 24 * 60 * 60 * 1000;

/** Previews nunca confirmados viram lixo: apaga os com mais de 24 h do workspace. */
export async function purgeStalePreviews(workspaceId: string): Promise<void> {
  await prisma.importBatch.deleteMany({
    where: { workspaceId, status: "preview", createdAt: { lt: new Date(Date.now() - STALE_PREVIEW_MS) } },
  });
}
```
Colocar a função exportada em `import-statement.service.ts` (fora da classe) e importá-la em `import.service.ts`. Chamar `await purgeStalePreviews(workspaceId);` nos dois previews.

- [ ] **Step 5: Saldos entre membros compensados**

Em `splits.service.ts`, `memberBalances`: após obter `rows`, compensar pares:

```ts
    const net = new Map<string, { payerId: string; debtorId: string; cents: number }>();
    for (const r of rows) {
      const key = [r.payerId, r.debtorId].sort().join("|");
      const cur = net.get(key) ?? { payerId: r.payerId, debtorId: r.debtorId, cents: 0 };
      cur.cents += r.payerId === cur.payerId ? Number(r.netCents) : -Number(r.netCents);
      net.set(key, cur);
    }
    const settled = [...net.values()]
      .filter((n) => n.cents !== 0)
      .map((n) => (n.cents > 0 ? n : { payerId: n.debtorId, debtorId: n.payerId, cents: -n.cents }));

    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(settled.flatMap((r) => [r.payerId, r.debtorId]))] } },
      select: { id: true, name: true, email: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return settled.map((r) => ({ payer: userMap.get(r.payerId), debtor: userMap.get(r.debtorId), owedCents: r.cents }));
```

- [ ] **Step 6: CI**

Em `.github/workflows/ci.yml`, trocar a lista de branches do `push` por:

```yaml
on:
  push:
    branches: ["**"]
  pull_request:
    branches: [main]
```

- [ ] **Step 7: Rodar tudo**

Run: `pnpm turbo typecheck && pnpm --filter @app/shared test && pnpm --filter @app/api test` → PASS (conferir especialmente `chat.e2e.test.ts` e `familia-pj.e2e.test.ts`; se um teste de splits esperar as duas linhas não compensadas, atualizar para o saldo líquido).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src packages/shared/src .github/workflows/ci.yml
git commit -m "fix(api): chat guarda a pergunta antes do modelo, previews antigos são apagados, saldos entre membros compensados, OFX decodifica entidades

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verificação final (depois da última tarefa)

```bash
pnpm turbo typecheck
pnpm --filter @app/shared test
pnpm --filter @app/worker test
pnpm --filter @app/web test
pnpm --filter @app/api test
pnpm --filter @app/web build
```

Tudo verde antes de abrir o PR. No PR, listar os itens da revisão fechados (1–19, 21, 23–28, 32, 34, 37, 38 e o 7 pela remoção do módulo offline) e os deixados para depois (20, 22, 29, 30, 31, 33, 35, 36, 39).
