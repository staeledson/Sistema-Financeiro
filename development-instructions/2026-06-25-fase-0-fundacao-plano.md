# Fase 0 — Fundação · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Convenção deste plano:** scaffolding de framework (criar projeto Nest/Vite, instalar libs) é descrito por **comandos exatos**. Código autoral (SQL, RLS, Zod, fila, auth, testes) é mostrado por completo. No seu repo, este arquivo vive em `docs/superpowers/plans/2026-06-25-fase-0-fundacao.md`.

**Goal:** Levantar o monorepo do SaaS com auth e-mail/senha, modelo `workspaces`/`workspace_members`, criação automática de workspace pessoal no signup e isolamento multi-tenant por RLS comprovado por testes — sem ainda lançar contas/transações.

**Architecture:** Monorepo pnpm+Turborepo. Supabase (Postgres+Auth+RLS) como banco/auth. API NestJS (Fastify) e workers BullMQ (Redis) em TypeScript. Front Vue 3 PWA. Tipos/schemas Zod compartilhados em `packages/shared`. RLS é a fronteira de isolamento, reforçada pela autorização do app.

**Tech Stack:** pnpm, Turborepo, TypeScript, Vitest, Supabase CLI, supabase-js, NestJS+Fastify, BullMQ, Redis (ioredis), Vue 3, Vite, Pinia, vue-router, vue-i18n, vite-plugin-pwa, GitHub Actions.

## Global Constraints

- Dinheiro: inteiro em centavos + ISO 4217. Nunca float. (Relevante a partir da Fase 1; nenhuma tabela monetária nesta fase.)
- Ledger: quase-double-entry — transferências com `account_origem`/`account_destino`, sem categoria. (Constraint futura; sem tabelas de transação nesta fase.)
- Moeda definida por workspace na criação (default `BRL`), imutável, sem câmbio.
- TypeScript ponta a ponta; schemas Zod compartilhados em `packages/shared`.
- Toda tabela com dado de usuário tem `workspace_id` e RLS habilitado.
- Node 20+. Gerenciador: pnpm. Test runner: Vitest em todos os pacotes.

---

## Mapa de arquivos (decomposição)

```
pnpm-workspace.yaml
turbo.json
package.json
tsconfig.base.json
.github/workflows/ci.yml
supabase/
  config.toml
  migrations/
    0001_enums_and_tables.sql
    0002_onboarding_trigger.sql
    0003_rls_policies.sql
packages/
  config/        (tsconfig + eslint base)
  shared/        (enums + Zod schemas + tipos)
apps/
  api/           (NestJS: WorkspacesModule, health enqueue, e2e + DB tests)
  worker/        (BullMQ: fila `system`, job health.noop, teste)
  web/           (Vue PWA: auth store, login/signup, i18n, design tokens)
```

---

## Task 1: Monorepo + tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`
- Create: `packages/config/package.json`, `packages/config/tsconfig.base.json`, `packages/config/eslint.config.js`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`, `packages/shared/src/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: workspace pnpm com `@app/config` e `@app/shared`; scripts `pnpm lint`, `pnpm typecheck`, `pnpm test` rodando via Turborepo.

- [ ] **Step 1: Inicializar o workspace**

```bash
mkdir -p packages/config packages/shared/src/__tests__
corepack enable
pnpm init
```

- [ ] **Step 2: Declarar o workspace e o Turborepo**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

`package.json` (root) — scripts e devDeps:
```json
{
  "name": "financas-ia",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "build": "turbo run build"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.5.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Pacote `@app/config`**

`packages/config/package.json`:
```json
{
  "name": "@app/config",
  "version": "0.0.0",
  "private": true,
  "main": "index.js"
}
```
`packages/config/tsconfig.base.json`: `{ "extends": "../../tsconfig.base.json" }`
`packages/config/eslint.config.js`:
```js
import tseslint from "typescript-eslint";
export default tseslint.config(...tseslint.configs.recommended);
```
Install: `pnpm add -D -w typescript-eslint eslint`

- [ ] **Step 4: Esqueleto de `@app/shared` com teste-fumaça (falha primeiro)**

`packages/shared/package.json`:
```json
{
  "name": "@app/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0", "eslint": "^9.0.0" }
}
```
`packages/shared/tsconfig.json`: `{ "extends": "../config/tsconfig.base.json", "include": ["src"] }`
`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```
`packages/shared/src/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PING } from "../index";
describe("shared", () => {
  it("exporta um valor", () => { expect(PING).toBe("pong"); });
});
```

- [ ] **Step 5: Rodar o teste e ver falhar**

Run: `pnpm install && pnpm --filter @app/shared test`
Expected: FAIL — `PING` não exportado (módulo `../index` sem o símbolo).

- [ ] **Step 6: Implementação mínima**

`packages/shared/src/index.ts`:
```ts
export const PING = "pong";
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @app/shared test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git init && git add -A
git commit -m "chore: scaffold pnpm+turborepo monorepo with shared/config packages"
```

---

## Task 2: `@app/shared` — enums e schemas Zod

**Files:**
- Create: `packages/shared/src/enums.ts`, `packages/shared/src/workspace.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/__tests__/workspace.test.ts`

**Interfaces:**
- Produces: `WorkspaceType`, `MemberRole` (const arrays + types); `workspaceSchema`, `workspaceMemberSchema` (Zod) e tipos `Workspace`, `WorkspaceMember`. Consumidos por api (Task 6) e web (Task 8).

- [ ] **Step 1: Teste dos schemas (falha primeiro)**

`packages/shared/src/__tests__/workspace.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { workspaceSchema, WORKSPACE_TYPES, MEMBER_ROLES } from "../index";

describe("workspaceSchema", () => {
  it("aceita um workspace válido", () => {
    const ok = workspaceSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      type: "personal",
      name: "Pessoal",
      currency: "BRL",
      createdBy: "22222222-2222-2222-2222-222222222222",
    });
    expect(ok.success).toBe(true);
  });

  it("rejeita type inválido", () => {
    const bad = workspaceSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      type: "invalid",
      name: "X",
      currency: "BRL",
      createdBy: "22222222-2222-2222-2222-222222222222",
    });
    expect(bad.success).toBe(false);
  });

  it("rejeita currency fora de 3 letras", () => {
    const bad = workspaceSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      type: "personal",
      name: "X",
      currency: "BRLL",
      createdBy: "22222222-2222-2222-2222-222222222222",
    });
    expect(bad.success).toBe(false);
  });

  it("expõe os enums esperados", () => {
    expect(WORKSPACE_TYPES).toEqual(["personal", "family", "business"]);
    expect(MEMBER_ROLES).toEqual(["owner", "admin", "member", "viewer"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/shared test`
Expected: FAIL — exports `workspaceSchema`, `WORKSPACE_TYPES`, `MEMBER_ROLES` inexistentes.

- [ ] **Step 3: Enums**

`packages/shared/src/enums.ts`:
```ts
export const WORKSPACE_TYPES = ["personal", "family", "business"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const MEMBER_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
```

- [ ] **Step 4: Schemas**

`packages/shared/src/workspace.ts`:
```ts
import { z } from "zod";
import { WORKSPACE_TYPES, MEMBER_ROLES } from "./enums";

export const workspaceSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(WORKSPACE_TYPES),
  name: z.string().min(1),
  currency: z.string().length(3).toUpperCase(),
  createdBy: z.string().uuid(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceMemberSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(MEMBER_ROLES),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;
```

- [ ] **Step 5: Reexportar**

`packages/shared/src/index.ts`:
```ts
export const PING = "pong";
export * from "./enums";
export * from "./workspace";
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @app/shared test`
Expected: PASS (4 testes).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(shared): workspace enums and zod schemas"
```

---

## Task 3: Supabase + migration base (enums + tabelas)

**Files:**
- Create: `supabase/config.toml` (via CLI), `supabase/migrations/0001_enums_and_tables.sql`
- Create: `apps/api` (parcial — só harness de teste de DB nesta task): `apps/api/package.json`, `apps/api/vitest.config.ts`, `apps/api/test/helpers/supabase.ts`
- Test: `apps/api/test/database/schema.test.ts`

**Interfaces:**
- Consumes: enums de domínio (Task 2) como referência.
- Produces: tabelas `workspaces`, `workspace_members`; enums `workspace_type`, `member_role`. Consumidas pelas Tasks 4, 5, 6.

- [ ] **Step 1: Inicializar Supabase local**

```bash
pnpm add -D -w supabase
pnpm supabase init
pnpm supabase start
```
Expected: containers sobem; CLI imprime `API URL`, `anon key`, `service_role key`. Anote-os para `.env.test`.

- [ ] **Step 2: Harness de teste de DB**

`apps/api/package.json` (mínimo para esta task; expandido na Task 6):
```json
{
  "name": "@app/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run" },
  "devDependencies": {
    "vitest": "^2.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "dotenv": "^16.4.0"
  }
}
```
`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", hookTimeout: 30000, testTimeout: 30000 },
});
```
`apps/api/test/helpers/supabase.ts`:
```ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_ANON_KEY!;

export const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export function anonClient() {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

let n = 0;
export async function createUser() {
  const email = `t${Date.now()}_${n++}@example.com`;
  const password = "password123!";
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error) throw error;
  const client = anonClient();
  const { data: signIn, error: sErr } =
    await client.auth.signInWithPassword({ email, password });
  if (sErr) throw sErr;
  return { id: data.user!.id, email, client, accessToken: signIn.session!.access_token };
}
```
`.env.test` (preencher com as chaves do Step 1):
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

- [ ] **Step 3: Teste de schema (falha primeiro)**

`apps/api/test/database/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { admin } from "../helpers/supabase";

describe("schema base", () => {
  it("workspaces existe com as colunas esperadas", async () => {
    const { error } = await admin.from("workspaces")
      .select("id,type,name,currency,created_by,created_at,updated_at").limit(0);
    expect(error).toBeNull();
  });

  it("workspace_members existe com as colunas esperadas", async () => {
    const { error } = await admin.from("workspace_members")
      .select("id,workspace_id,user_id,role,created_at").limit(0);
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm --filter @app/api test -- schema`
Expected: FAIL — relação `workspaces` não existe.

- [ ] **Step 5: Migration de enums e tabelas**

`supabase/migrations/0001_enums_and_tables.sql`:
```sql
create type workspace_type as enum ('personal', 'family', 'business');
create type member_role as enum ('owner', 'admin', 'member', 'viewer');

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  type workspace_type not null,
  name text not null,
  currency char(3) not null default 'BRL',
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role member_role not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_user_id_idx on workspace_members(user_id);
create index workspace_members_workspace_id_idx on workspace_members(workspace_id);
```

- [ ] **Step 6: Aplicar e ver passar**

Run: `pnpm supabase db reset && pnpm --filter @app/api test -- schema`
Expected: PASS (2 testes). `db reset` aplica todas as migrations em banco limpo.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(db): base enums and workspaces/workspace_members tables"
```

---

## Task 4: Trigger de onboarding `handle_new_user()`

**Files:**
- Create: `supabase/migrations/0002_onboarding_trigger.sql`
- Test: `apps/api/test/database/onboarding.test.ts`

**Interfaces:**
- Consumes: tabelas da Task 3.
- Produces: garantia de que todo novo usuário ganha 1 workspace `personal` + 1 membership `owner`. (Cenário T1.)

- [ ] **Step 1: Teste do trigger (falha primeiro)**

`apps/api/test/database/onboarding.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { admin, createUser } from "../helpers/supabase";

describe("onboarding trigger", () => {
  it("cria 1 workspace pessoal e 1 membership owner no signup", async () => {
    const user = await createUser();

    const { data: ws } = await admin.from("workspaces")
      .select("*").eq("created_by", user.id);
    expect(ws).toHaveLength(1);
    expect(ws![0].type).toBe("personal");
    expect(ws![0].currency).toBe("BRL");

    const { data: mem } = await admin.from("workspace_members")
      .select("*").eq("user_id", user.id);
    expect(mem).toHaveLength(1);
    expect(mem![0].role).toBe("owner");
    expect(mem![0].workspace_id).toBe(ws![0].id);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api test -- onboarding`
Expected: FAIL — `ws` tem length 0 (nenhum trigger ainda).

- [ ] **Step 3: Migration do trigger**

`supabase/migrations/0002_onboarding_trigger.sql`:
```sql
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ws_id uuid;
begin
  insert into workspaces (type, name, currency, created_by)
  values ('personal', 'Pessoal', 'BRL', new.id)
  returning id into new_ws_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (new_ws_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

- [ ] **Step 4: Aplicar e ver passar**

Run: `pnpm supabase db reset && pnpm --filter @app/api test -- onboarding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): auto-create personal workspace + owner membership on signup"
```

---

## Task 5: RLS — helper `is_member()` + policies

**Files:**
- Create: `supabase/migrations/0003_rls_policies.sql`
- Test: `apps/api/test/database/rls.test.ts`

**Interfaces:**
- Consumes: tabelas (Task 3) e trigger (Task 4).
- Produces: isolamento por `workspace_id` aplicado no banco. (Cenários T2, T3, T4.)

- [ ] **Step 1: Testes de isolamento (falham primeiro)**

`apps/api/test/database/rls.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createUser } from "../helpers/supabase";

describe("RLS", () => {
  it("T2: usuário A não lê o workspace de B", async () => {
    const a = await createUser();
    const b = await createUser();

    const { data: aRows } = await a.client.from("workspaces").select("*");
    expect(aRows).toHaveLength(1);

    const { data: bRows } = await b.client.from("workspaces").select("*");
    expect(bRows).toHaveLength(1);

    expect(aRows![0].id).not.toBe(bRows![0].id);
  });

  it("T3: usuário A não insere membership em workspace que não administra", async () => {
    const a = await createUser();
    const b = await createUser();
    const { data: bRows } = await b.client.from("workspaces").select("id");
    const bWorkspaceId = bRows![0].id;

    const { error } = await a.client.from("workspace_members")
      .insert({ workspace_id: bWorkspaceId, user_id: a.id, role: "member" });
    expect(error).not.toBeNull(); // bloqueado por RLS
  });

  it("T4: ler membros do próprio workspace não estoura recursão", async () => {
    const a = await createUser();
    const { data, error } = await a.client.from("workspace_members").select("*");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].role).toBe("owner");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/api test -- rls`
Expected: FAIL — sem RLS, A enxerga workspaces de B (T2) e o insert de T3 não é bloqueado.

- [ ] **Step 3: Migration de RLS**

`supabase/migrations/0003_rls_policies.sql`:
```sql
-- Helper SECURITY DEFINER evita recursão de RLS em workspace_members.
create or replace function is_member(target_workspace uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = target_workspace and user_id = auth.uid()
  );
$$;

create or replace function has_role(target_workspace uuid, roles member_role[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and role = any(roles)
  );
$$;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;

-- workspaces
create policy workspaces_select on workspaces
  for select using (is_member(id));

create policy workspaces_insert on workspaces
  for insert with check (created_by = auth.uid());

create policy workspaces_update on workspaces
  for update using (has_role(id, array['owner','admin']::member_role[]));

create policy workspaces_delete on workspaces
  for delete using (has_role(id, array['owner']::member_role[]));

-- workspace_members
create policy members_select on workspace_members
  for select using (is_member(workspace_id));

create policy members_insert on workspace_members
  for insert with check (has_role(workspace_id, array['owner','admin']::member_role[]));

create policy members_delete on workspace_members
  for delete using (has_role(workspace_id, array['owner','admin']::member_role[]));
```

- [ ] **Step 4: Aplicar e ver passar**

Run: `pnpm supabase db reset && pnpm --filter @app/api test -- rls`
Expected: PASS (3 testes). Nota: o trigger insere via `security definer` (bypassa RLS), então o owner inicial continua sendo criado.

- [ ] **Step 5: Rodar a suíte de DB inteira**

Run: `pnpm supabase db reset && pnpm --filter @app/api test -- database`
Expected: PASS (schema + onboarding + rls).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(db): RLS isolation via is_member/has_role helpers and policies"
```

---

## Task 6: API NestJS + endpoint de workspaces (isolamento ponta a ponta)

**Files:**
- Create (scaffold via CLI) + Modify: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/supabase/supabase-request.ts`, `apps/api/src/workspaces/workspaces.controller.ts`, `apps/api/src/workspaces/workspaces.service.ts`, `apps/api/src/workspaces/workspaces.module.ts`
- Test: `apps/api/test/e2e/workspaces.e2e.test.ts`

**Interfaces:**
- Consumes: `Workspace` de `@app/shared`; tabelas/RLS das Tasks 3–5.
- Produces: `GET /workspaces` que retorna **apenas** os workspaces do chamador (RLS aplicada via JWT do usuário). Consumido pela web (Task 8).

- [ ] **Step 1: Scaffold NestJS com Fastify**

```bash
cd apps/api
pnpm dlx @nestjs/cli@latest new . --skip-git --package-manager pnpm --strict
pnpm add @nestjs/platform-fastify @supabase/supabase-js @app/shared
pnpm add -D supertest @types/supertest
```
Ajustar `apps/api/package.json` `name` para `@app/api` e manter os scripts `test` (vitest) ao lado dos do Nest.

- [ ] **Step 2: Teste e2e de isolamento (falha primeiro)**

`apps/api/test/e2e/workspaces.e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NestFastifyApplication, FastifyAdapter } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AppModule } from "../../src/app.module";
import { createUser } from "../helpers/supabase";

let app: NestFastifyApplication;
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => { await app.close(); });

describe("GET /workspaces", () => {
  it("retorna só os workspaces do usuário autenticado", async () => {
    const a = await createUser();
    const res = await app.inject({
      method: "GET", url: "/workspaces",
      headers: { authorization: `Bearer ${a.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].type).toBe("personal");
  });

  it("401 sem token", async () => {
    const res = await app.inject({ method: "GET", url: "/workspaces" });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @app/api test -- workspaces.e2e`
Expected: FAIL — rota `/workspaces` inexistente (404).

- [ ] **Step 4: Cliente Supabase por request (propaga o JWT → RLS)**

`apps/api/src/supabase/supabase-request.ts`:
```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function clientFromToken(token: string): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 5: Service**

`apps/api/src/workspaces/workspaces.service.ts`:
```ts
import { Injectable } from "@nestjs/common";
import { clientFromToken } from "../supabase/supabase-request";

@Injectable()
export class WorkspacesService {
  async listForToken(token: string) {
    const supabase = clientFromToken(token);
    const { data, error } = await supabase
      .from("workspaces")
      .select("id,type,name,currency,created_by");
    if (error) throw error;
    return data ?? [];
  }
}
```

- [ ] **Step 6: Controller (extrai e exige o Bearer)**

`apps/api/src/workspaces/workspaces.controller.ts`:
```ts
import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service";

@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService) {}

  @Get()
  async list(@Headers("authorization") auth?: string) {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException();
    return this.service.listForToken(token);
  }
}
```

- [ ] **Step 7: Módulo e wiring**

`apps/api/src/workspaces/workspaces.module.ts`:
```ts
import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService] })
export class WorkspacesModule {}
```
Em `apps/api/src/app.module.ts`, importar `WorkspacesModule` no array `imports`.

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm supabase db reset && pnpm --filter @app/api test -- workspaces.e2e`
Expected: PASS (2 testes). Isolamento agora é provado ponta a ponta (HTTP → Nest → Supabase com JWT → RLS).

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(api): NestJS skeleton + GET /workspaces enforcing RLS via user JWT"
```

---

## Task 7: Worker BullMQ + job `health.noop`

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/vitest.config.ts`, `apps/worker/src/queue.ts`, `apps/worker/src/health.processor.ts`
- Test: `apps/worker/test/health.test.ts`

**Interfaces:**
- Produces: fila `system` com job `health.noop` processável. (Cenário T5.)

- [ ] **Step 1: Pacote do worker**

`apps/worker/package.json`:
```json
{
  "name": "@app/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "bullmq": "^5.0.0", "ioredis": "^5.4.0" },
  "devDependencies": { "vitest": "^2.0.0", "typescript": "^5.5.0" }
}
```
`apps/worker/tsconfig.json`: `{ "extends": "../../packages/config/tsconfig.base.json", "include": ["src","test"] }`
`apps/worker/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", testTimeout: 20000 } });
```
Garanta um Redis local (Supabase não provê): `docker run -d -p 6379:6379 redis:7`.

- [ ] **Step 2: Teste do job (falha primeiro)**

`apps/worker/test/health.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { registerHealthWorker } from "../src/health.processor";

const connection = new IORedis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: null,
});

afterAll(async () => { await connection.quit(); });

describe("fila system", () => {
  it("processa health.noop até completar", async () => {
    const worker = registerHealthWorker(connection);
    const queue = new Queue("system", { connection });
    const events = new QueueEvents("system", { connection });
    await events.waitUntilReady();

    const job = await queue.add("health.noop", {});
    const result = await job.waitUntilFinished(events);
    expect(result).toEqual({ ok: true });

    await worker.close(); await queue.close(); await events.close();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @app/worker test`
Expected: FAIL — `registerHealthWorker` não existe.

- [ ] **Step 4: Fila e processor**

`apps/worker/src/queue.ts`:
```ts
export const SYSTEM_QUEUE = "system";
export const HEALTH_NOOP = "health.noop";
```
`apps/worker/src/health.processor.ts`:
```ts
import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { SYSTEM_QUEUE, HEALTH_NOOP } from "./queue";

export function registerHealthWorker(connection: Redis) {
  return new Worker(
    SYSTEM_QUEUE,
    async (job) => {
      if (job.name === HEALTH_NOOP) return { ok: true };
      return { ok: false };
    },
    { connection },
  );
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @app/worker test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(worker): BullMQ system queue with health.noop job"
```

---

## Task 8: Web Vue PWA — auth, i18n, design tokens

**Files:**
- Create (scaffold via CLI) + Modify: `apps/web/*`
- Create: `apps/web/src/lib/supabase.ts`, `apps/web/src/stores/auth.ts`, `apps/web/src/views/LoginView.vue`, `apps/web/src/i18n/pt-BR.ts`, `apps/web/src/styles/tokens.css`
- Test: `apps/web/src/stores/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: Supabase Auth; `GET /workspaces` (Task 6) para mostrar o workspace pessoal pós-login.
- Produces: app instalável (PWA) com signup/login funcionando.

- [ ] **Step 1: Scaffold Vue + libs**

```bash
cd apps/web
pnpm create vite@latest . -- --template vue-ts
pnpm add vue-router pinia vue-i18n @supabase/supabase-js @app/shared
pnpm add -D vite-plugin-pwa vitest @vue/test-utils jsdom
```
Em `apps/web/package.json`: `name` = `@app/web`; adicionar `"test": "vitest run"`, `"typecheck": "vue-tsc --noEmit"`.
Em `vite.config.ts`: registrar `VitePWA({ registerType: "autoUpdate" })`.
Criar `apps/web/.env`: `VITE_SUPABASE_URL=`, `VITE_SUPABASE_ANON_KEY=`, `VITE_API_URL=http://127.0.0.1:3000`.

- [ ] **Step 2: Cliente Supabase do front**

`apps/web/src/lib/supabase.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
```

- [ ] **Step 3: Teste do store de auth (falha primeiro)**

`apps/web/src/stores/__tests__/auth.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(async () => ({
        data: { session: { access_token: "tok" }, user: { id: "u1" } }, error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  },
}));

import { useAuthStore } from "../auth";

describe("auth store", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("login define o token e o usuário", async () => {
    const store = useAuthStore();
    await store.signIn("a@example.com", "x");
    expect(store.accessToken).toBe("tok");
    expect(store.userId).toBe("u1");
    expect(store.isAuthenticated).toBe(true);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm --filter @app/web test -- auth`
Expected: FAIL — store `../auth` inexistente.

- [ ] **Step 5: Store de auth**

`apps/web/src/stores/auth.ts`:
```ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { supabase } from "../lib/supabase";

export const useAuthStore = defineStore("auth", () => {
  const accessToken = ref<string | null>(null);
  const userId = ref<string | null>(null);
  const isAuthenticated = computed(() => !!accessToken.value);

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    accessToken.value = data.session?.access_token ?? null;
    userId.value = data.user?.id ?? null;
  }
  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }
  async function signOut() {
    await supabase.auth.signOut();
    accessToken.value = null; userId.value = null;
  }
  return { accessToken, userId, isAuthenticated, signIn, signUp, signOut };
});
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @app/web test -- auth`
Expected: PASS.

- [ ] **Step 7: i18n, tokens e a view de login (sem novo teste; verificação manual)**

`apps/web/src/i18n/pt-BR.ts`:
```ts
export default {
  auth: { login: "Entrar", signup: "Criar conta", email: "E-mail", password: "Senha" },
  workspace: { personal: "Pessoal" },
};
```
`apps/web/src/styles/tokens.css`:
```css
:root {
  --color-bg: #0b0b0f; --color-surface: #15151c; --color-primary: #4f7cff;
  --color-text: #e8e8ef; --radius: 12px; --space: 8px;
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}
```
`apps/web/src/views/LoginView.vue`:
```vue
<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "../stores/auth";
const auth = useAuthStore();
const email = ref(""); const password = ref(""); const erro = ref("");
async function entrar() {
  erro.value = "";
  try { await auth.signIn(email.value, password.value); }
  catch (e) { erro.value = (e as Error).message; }
}
</script>
<template>
  <main class="login">
    <input v-model="email" type="email" placeholder="E-mail" />
    <input v-model="password" type="password" placeholder="Senha" />
    <button @click="entrar">Entrar</button>
    <p v-if="erro" role="alert">{{ erro }}</p>
  </main>
</template>
```
Verificação manual: `pnpm --filter @app/web dev`, criar conta, logar; confirmar sessão. (O consumo de `GET /workspaces` para exibir o workspace pessoal pode ser ligado aqui ou no início da Fase 1.)

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(web): Vue PWA scaffold with auth store, i18n pt-BR and design tokens"
```

---

## Task 9: CI (GitHub Actions)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: pipeline que roda lint + typecheck + testes com Supabase e Redis efêmeros. (Cenário T6.)

- [ ] **Step 1: Workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on: [push, pull_request]
jobs:
  build-test:
    runs-on: ubuntu-latest
    services:
      redis:
        image: redis:7
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase start
      - name: Exportar chaves do Supabase para o ambiente de teste
        run: |
          echo "SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d= -f2)" >> .env.test
          echo "SUPABASE_ANON_KEY=$(supabase status -o env | grep ANON_KEY | cut -d= -f2)" >> .env.test
          echo "SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2)" >> .env.test
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
        env:
          REDIS_URL: redis://127.0.0.1:6379
```
> Nota de execução: confirmar os nomes exatos das chaves em `supabase status -o env` na versão da CLI usada e ajustar os `grep` se necessário. Esse é o único ponto do plano sensível à versão da ferramenta.

- [ ] **Step 2: Verificar verde**

Push para um branch e abrir PR. Expected: job `build-test` verde (lint, typecheck, e as suítes de shared/api/worker/web passando).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: lint+typecheck+test with ephemeral supabase and redis"
```

---

## Self-review (feito)

- **Cobertura do spec:** T1 (Task 4) · T2/T3/T4 (Task 5) · T5 (Task 7) · T6 (Task 9). Modelo de dados (Task 3), auth/onboarding (Tasks 4/8), RLS (Task 5), fila (Task 7), monorepo/transversais (Tasks 1/8/9). Todos os itens do DoD têm tarefa.
- **Sem placeholders:** cada passo de código traz o código; scaffolding usa comandos exatos (convenção declarada no topo).
- **Consistência de tipos:** `WORKSPACE_TYPES`/`MEMBER_ROLES` e os campos (`currency` char(3), `role`) batem entre `@app/shared`, as migrations e o endpoint.
- **Ponto sensível a versão (único):** parsing das chaves em `supabase status -o env` no CI (Task 9, Step 1) — sinalizado inline.

---

## Execução

**Plano completo.** Duas opções:

1. **Subagent-Driven (recomendado)** — um subagente fresco por tarefa, com review entre tarefas; iteração rápida. Use `superpowers:subagent-driven-development`. As Tasks 1–9 são majoritariamente sequenciais (cada uma depende da anterior), então o ganho do subagent é o review limpo por tarefa, não paralelismo.
2. **Inline** — executar as tarefas nesta sessão com checkpoints. Use `superpowers:executing-plans`.

Recomendo **subagent-driven** pela natureza "fundação" (vale o gate de review por tarefa, sobretudo nas Tasks 4–6 de DB/RLS).
