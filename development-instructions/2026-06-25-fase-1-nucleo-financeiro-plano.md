# Fase 1 — Núcleo Financeiro · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (recommended) ou `superpowers:executing-plans`. Steps em checkbox (`- [ ]`).
>
> **Convenção:** scaffolding de framework por comandos exatos; código autoral (SQL, RLS, validações, testes) por completo. Reusa o harness de teste da Fase 0 (`apps/api/test/helpers/supabase.ts` → `admin`, `createUser`). Repo: `docs/superpowers/plans/2026-06-25-fase-1-nucleo-financeiro.md`.

**Goal:** Contas, categorias (seed BR), tags, lançamento manual de receita/despesa/transferência, listagem com filtros, saldo derivado correto e dashboard básico — tudo isolado por workspace.

**Architecture:** Migrations Supabase para o schema financeiro com RLS no padrão `is_member`/`has_role` da Fase 0. Saldo via view `account_balances` (`security_invoker`). Dashboard via RPCs SQL. API NestJS expõe CRUD e leituras; web Vue consome. Transferência em linha única com origem/destino.

**Tech Stack:** Supabase CLI, supabase-js, NestJS, Vitest, Vue 3 + Pinia, `@app/shared` (Zod).

## Global Constraints

- Centavos (bigint), moeda por workspace, ledger quase-double-entry (transfer com origem/destino, sem categoria).
- `amount_cents > 0`. Transferência não conta como gasto.
- RLS em toda tabela com `workspace_id`. Saldo derivado (sem cache).
- Migrations continuam a numeração da Fase 0 (próxima: `0004`).

---

## Task 1: `@app/shared` — enums e schemas financeiros

**Files:**
- Create: `packages/shared/src/finance.ts`; Modify: `packages/shared/src/enums.ts`, `src/index.ts`
- Test: `packages/shared/src/__tests__/finance.test.ts`

**Interfaces:**
- Produces: `ACCOUNT_TYPES`, `CATEGORY_TYPES`, `TRANSACTION_TYPES`; `accountSchema`, `categorySchema`, `transactionInputSchema` (com refine de forma). Consumido por api (Tasks 2–5) e web (Task 8).

- [ ] **Step 1: Teste (falha primeiro)**

`packages/shared/src/__tests__/finance.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { transactionInputSchema, ACCOUNT_TYPES } from "../index";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const C = "33333333-3333-3333-3333-333333333333";

describe("finance schemas", () => {
  it("expõe account types", () => {
    expect(ACCOUNT_TYPES).toContain("credit_card");
  });
  it("aceita despesa válida", () => {
    expect(transactionInputSchema.safeParse({
      type: "expense", amountCents: 3500, date: "2026-06-01",
      accountId: A, categoryId: B,
    }).success).toBe(true);
  });
  it("rejeita transfer com categoria", () => {
    expect(transactionInputSchema.safeParse({
      type: "transfer", amountCents: 1000, date: "2026-06-01",
      sourceAccountId: A, destAccountId: B, categoryId: C,
    }).success).toBe(false);
  });
  it("rejeita transfer com origem=destino", () => {
    expect(transactionInputSchema.safeParse({
      type: "transfer", amountCents: 1000, date: "2026-06-01",
      sourceAccountId: A, destAccountId: A,
    }).success).toBe(false);
  });
  it("rejeita amount <= 0", () => {
    expect(transactionInputSchema.safeParse({
      type: "income", amountCents: 0, date: "2026-06-01", accountId: A,
    }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @app/shared test -- finance`
Expected: FAIL — exports inexistentes.

- [ ] **Step 3: Enums novos** — em `packages/shared/src/enums.ts` acrescentar:
```ts
export const ACCOUNT_TYPES = ["checking","savings","credit_card","cash","investment"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const CATEGORY_TYPES = ["income","expense"] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const TRANSACTION_TYPES = ["income","expense","transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
```

- [ ] **Step 4: Schemas** — `packages/shared/src/finance.ts`:
```ts
import { z } from "zod";
import { ACCOUNT_TYPES, CATEGORY_TYPES, TRANSACTION_TYPES } from "./enums";

export const accountSchema = z.object({
  type: z.enum(ACCOUNT_TYPES),
  name: z.string().min(1),
  openingBalanceCents: z.number().int().default(0),
});

export const categorySchema = z.object({
  type: z.enum(CATEGORY_TYPES),
  name: z.string().min(1),
  parentId: z.string().uuid().nullish(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
});

export const transactionInputSchema = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amountCents: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  accountId: z.string().uuid().nullish(),
  sourceAccountId: z.string().uuid().nullish(),
  destAccountId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  description: z.string().nullish(),
  counterparty: z.string().nullish(),
}).superRefine((v, ctx) => {
  if (v.type === "transfer") {
    if (!v.sourceAccountId || !v.destAccountId)
      ctx.addIssue({ code: "custom", message: "transfer requer origem e destino" });
    if (v.sourceAccountId && v.sourceAccountId === v.destAccountId)
      ctx.addIssue({ code: "custom", message: "origem e destino devem diferir" });
    if (v.categoryId)
      ctx.addIssue({ code: "custom", message: "transfer não tem categoria" });
    if (v.accountId)
      ctx.addIssue({ code: "custom", message: "transfer usa origem/destino" });
  } else {
    if (!v.accountId)
      ctx.addIssue({ code: "custom", message: "income/expense requer conta" });
    if (v.sourceAccountId || v.destAccountId)
      ctx.addIssue({ code: "custom", message: "income/expense não usa origem/destino" });
  }
});
export type TransactionInput = z.infer<typeof transactionInputSchema>;
```

- [ ] **Step 5: Reexportar** — em `src/index.ts` acrescentar `export * from "./finance";`

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @app/shared test -- finance`
Expected: PASS.

- [ ] **Step 7: Commit** — `git commit -am "feat(shared): finance enums and transaction input schema"`

---

## Task 2: `accounts` — migration, RLS, CRUD, arquivar

**Files:**
- Create: `supabase/migrations/0004_accounts.sql`; `apps/api/src/accounts/*` (module/controller/service)
- Test: `apps/api/test/database/accounts.test.ts`; `apps/api/test/e2e/accounts.e2e.test.ts`

**Interfaces:**
- Consumes: `is_member`/`has_role` (Fase 0); `accountSchema` (Task 1).
- Produces: tabela `accounts`; `POST /accounts`, `GET /accounts` (ativas), `PATCH /accounts/:id/archive`. Contas consumidas por transações (Task 5) e saldo (Task 6).

- [ ] **Step 1: Teste de DB/RLS (falha primeiro)**

`apps/api/test/database/accounts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createUser } from "../helpers/supabase";

async function workspaceOf(u: Awaited<ReturnType<typeof createUser>>) {
  const { data } = await u.client.from("workspaces").select("id");
  return data![0].id as string;
}

describe("accounts RLS", () => {
  it("membro cria e lê a própria conta; outro não vê", async () => {
    const a = await createUser(); const b = await createUser();
    const wa = await workspaceOf(a);
    const { error } = await a.client.from("accounts")
      .insert({ workspace_id: wa, type: "checking", name: "Conta A" });
    expect(error).toBeNull();

    const { data: aRows } = await a.client.from("accounts").select("*");
    expect(aRows).toHaveLength(1);
    const { data: bRows } = await b.client.from("accounts").select("*");
    expect(bRows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @app/api test -- accounts.test` → FAIL (relação `accounts` não existe).

- [ ] **Step 3: Migration** — `supabase/migrations/0004_accounts.sql`:
```sql
create type account_type as enum ('checking','savings','credit_card','cash','investment');

create table accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type account_type not null,
  name text not null,
  opening_balance_cents bigint not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index accounts_workspace_idx on accounts(workspace_id);

alter table accounts enable row level security;
create policy accounts_select on accounts for select using (is_member(workspace_id));
create policy accounts_insert on accounts for insert
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
create policy accounts_update on accounts for update
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: Aplicar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- accounts.test` → PASS.

- [ ] **Step 5: e2e do endpoint (falha primeiro)**

`apps/api/test/e2e/accounts.e2e.test.ts`:
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
  await app.init(); await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => { await app.close(); });

describe("accounts API", () => {
  it("cria, lista e arquiva", async () => {
    const u = await createUser();
    const h = { authorization: `Bearer ${u.accessToken}` };

    const created = await app.inject({ method: "POST", url: "/accounts", headers: h,
      payload: { type: "checking", name: "Nubank", openingBalanceCents: 10000 } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    let list = await app.inject({ method: "GET", url: "/accounts", headers: h });
    expect(list.json()).toHaveLength(1);

    const arch = await app.inject({ method: "PATCH", url: `/accounts/${id}/archive`, headers: h });
    expect(arch.statusCode).toBe(200);

    list = await app.inject({ method: "GET", url: "/accounts", headers: h });
    expect(list.json()).toHaveLength(0); // arquivadas somem da lista ativa
  });
});
```

- [ ] **Step 6: Rodar e ver falhar** — `pnpm --filter @app/api test -- accounts.e2e` → FAIL (rota inexistente).

- [ ] **Step 7: Service** — `apps/api/src/accounts/accounts.service.ts`:
```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import { clientFromToken } from "../supabase/supabase-request";

@Injectable()
export class AccountsService {
  async create(token: string, dto: { type: string; name: string; openingBalanceCents?: number }) {
    const sb = clientFromToken(token);
    const { data: ws } = await sb.from("workspaces").select("id").limit(1).single();
    const { data, error } = await sb.from("accounts").insert({
      workspace_id: ws!.id, type: dto.type, name: dto.name,
      opening_balance_cents: dto.openingBalanceCents ?? 0,
    }).select().single();
    if (error) throw error;
    return data;
  }
  async listActive(token: string) {
    const sb = clientFromToken(token);
    const { data, error } = await sb.from("accounts")
      .select("*").eq("archived", false).order("created_at");
    if (error) throw error;
    return data ?? [];
  }
  async archive(token: string, id: string) {
    const sb = clientFromToken(token);
    const { data, error } = await sb.from("accounts")
      .update({ archived: true }).eq("id", id).select();
    if (error) throw error;
    if (!data || data.length === 0) throw new NotFoundException();
    return { ok: true };
  }
}
```
> Nota: `workspaces ... limit(1)` assume o workspace pessoal único da Fase 1. Quando entrar multi-workspace ativo (Fase 5), o `workspace_id` virá de header/param.

- [ ] **Step 8: Controller** — `apps/api/src/accounts/accounts.controller.ts`:
```ts
import { Body, Controller, Get, Headers, Param, Patch, Post, UnauthorizedException } from "@nestjs/common";
import { accountSchema } from "@app/shared";
import { AccountsService } from "./accounts.service";

function tokenOf(auth?: string) {
  const t = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!t) throw new UnauthorizedException();
  return t;
}

@Controller("accounts")
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  create(@Headers("authorization") auth: string | undefined, @Body() body: unknown) {
    const dto = accountSchema.parse(body);
    return this.service.create(tokenOf(auth), dto);
  }
  @Get()
  list(@Headers("authorization") auth?: string) {
    return this.service.listActive(tokenOf(auth));
  }
  @Patch(":id/archive")
  archive(@Headers("authorization") auth: string | undefined, @Param("id") id: string) {
    return this.service.archive(tokenOf(auth), id);
  }
}
```
`apps/api/src/accounts/accounts.module.ts` e registro no `app.module.ts` (padrão da Task 6 da Fase 0).

- [ ] **Step 9: Rodar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- accounts.e2e` → PASS.

- [ ] **Step 10: Commit** — `git commit -am "feat(accounts): table+RLS and CRUD with archive"`

---

## Task 3: `categories` — migration, seed BR, trigger, CRUD

**Files:**
- Create: `supabase/migrations/0005_categories.sql`; `apps/api/src/categories/*`
- Test: `apps/api/test/database/categories.test.ts`

**Interfaces:**
- Produces: tabela `categories`; seed automático por workspace; `GET/POST/PATCH/DELETE /categories`.

- [ ] **Step 1: Teste do seed + RLS (falha primeiro)**

`apps/api/test/database/categories.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createUser } from "../helpers/supabase";

describe("categories seed + RLS", () => {
  it("novo workspace já vem com 5 receitas e 15 despesas", async () => {
    const u = await createUser();
    const { data: inc } = await u.client.from("categories").select("*").eq("type", "income");
    const { data: exp } = await u.client.from("categories").select("*").eq("type", "expense");
    expect(inc).toHaveLength(5);
    expect(exp).toHaveLength(15);
    expect(inc!.every(c => c.is_system)).toBe(true);
  });
  it("isola entre workspaces", async () => {
    const a = await createUser(); const b = await createUser();
    const { data: aRows } = await a.client.from("categories").select("id");
    const { data: bRows } = await b.client.from("categories").select("id");
    const aIds = new Set(aRows!.map(r => r.id));
    expect(bRows!.some(r => aIds.has(r.id))).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @app/api test -- categories.test` → FAIL.

- [ ] **Step 3: Migration + seed + trigger** — `supabase/migrations/0005_categories.sql`:
```sql
create type category_type as enum ('income','expense');

create table categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type category_type not null,
  parent_id uuid references categories(id) on delete set null,
  name text not null,
  icon text,
  color text,
  is_system boolean not null default false
);
create index categories_workspace_idx on categories(workspace_id);

alter table categories enable row level security;
create policy categories_select on categories for select using (is_member(workspace_id));
create policy categories_cud on categories for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));

create or replace function seed_default_categories(p_workspace uuid)
returns void language sql security definer set search_path = public as $$
  insert into categories (workspace_id, type, name, is_system) values
    (p_workspace,'income','Salário',true),
    (p_workspace,'income','Freelance',true),
    (p_workspace,'income','Investimentos',true),
    (p_workspace,'income','Reembolso',true),
    (p_workspace,'income','Outras receitas',true),
    (p_workspace,'expense','Moradia',true),
    (p_workspace,'expense','Contas e utilidades',true),
    (p_workspace,'expense','Supermercado',true),
    (p_workspace,'expense','Restaurantes e delivery',true),
    (p_workspace,'expense','Transporte',true),
    (p_workspace,'expense','Combustível',true),
    (p_workspace,'expense','Saúde',true),
    (p_workspace,'expense','Farmácia',true),
    (p_workspace,'expense','Educação',true),
    (p_workspace,'expense','Lazer',true),
    (p_workspace,'expense','Compras',true),
    (p_workspace,'expense','Assinaturas',true),
    (p_workspace,'expense','Impostos e taxas',true),
    (p_workspace,'expense','Pets',true),
    (p_workspace,'expense','Outras despesas',true);
$$;

create or replace function on_workspace_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform seed_default_categories(new.id);
  return new;
end; $$;

create trigger seed_categories_after_workspace
  after insert on workspaces
  for each row execute function on_workspace_created();
```
> O seed é `security definer` porque roda dentro do insert do workspace, antes de a membership existir — RLS bloquearia.

- [ ] **Step 4: Aplicar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- categories.test` → PASS.

- [ ] **Step 5: CRUD da API** — criar `apps/api/src/categories/` (controller/service/module) no padrão das Tasks anteriores: `GET /categories` (opcional `?type=`), `POST`, `PATCH /:id`, `DELETE /:id`, validando body com `categorySchema`. Registrar no `app.module.ts`. (Sem novo teste de DB; cobertura via teste e2e mínimo de criar+listar, no mesmo molde do accounts.e2e.)

- [ ] **Step 6: Commit** — `git commit -am "feat(categories): table, BR seed via workspace trigger, RLS and CRUD"`

---

## Task 4: `tags` + `transaction_tags`

**Files:** Create `supabase/migrations/0006_tags.sql`; `apps/api/src/tags/*`. Test: `apps/api/test/database/tags.test.ts`.

**Interfaces:** Produces tabelas de tag e vínculo N:N; `GET/POST /tags`. Vínculo aplicado ao criar transação (Task 5).

- [ ] **Step 1: Teste RLS (falha primeiro)** — criar conta de tag para usuário A, garantir B não vê (mesmo molde do accounts.test).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0006_tags.sql`:
```sql
create table tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  unique (workspace_id, name)
);
alter table tags enable row level security;
create policy tags_select on tags for select using (is_member(workspace_id));
create policy tags_cud on tags for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));

create table transaction_tags (
  transaction_id uuid not null,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (transaction_id, tag_id)
);
-- FK para transactions é adicionada na Task 5 (after 0007), via migration 0008.
alter table transaction_tags enable row level security;
create policy txtags_all on transaction_tags for all
  using (exists (select 1 from tags t
    where t.id = tag_id and is_member(t.workspace_id)))
  with check (exists (select 1 from tags t
    where t.id = tag_id and is_member(t.workspace_id)));
```

- [ ] **Step 4: Aplicar e ver passar.**

- [ ] **Step 5: API `tags`** — `GET /tags`, `POST /tags` no molde usual.

- [ ] **Step 6: Commit** — `git commit -am "feat(tags): tags and transaction_tags with RLS"`

---

## Task 5: `transactions` — migration (CHECK de forma) + validações + create/list

**Files:** Create `supabase/migrations/0007_transactions.sql`, `supabase/migrations/0008_transaction_tags_fk.sql`; `apps/api/src/transactions/*`. Test: `apps/api/test/database/transactions.test.ts`, `apps/api/test/e2e/transactions.e2e.test.ts`.

**Interfaces:**
- Consumes: `accounts` (Task 2), `categories` (Task 3), `transactionInputSchema` (Task 1).
- Produces: tabela `transactions`; `POST /transactions`, `GET /transactions` (filtros). Consumida por saldo (Task 6) e dashboard (Task 7).

- [ ] **Step 1: Teste de forma no DB (falha primeiro)**

`apps/api/test/database/transactions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createUser } from "../helpers/supabase";

async function setup(u: Awaited<ReturnType<typeof createUser>>) {
  const { data: ws } = await u.client.from("workspaces").select("id");
  const wid = ws![0].id;
  const { data: a1 } = await u.client.from("accounts")
    .insert({ workspace_id: wid, type: "checking", name: "C1" }).select().single();
  const { data: a2 } = await u.client.from("accounts")
    .insert({ workspace_id: wid, type: "savings", name: "C2" }).select().single();
  const { data: cat } = await u.client.from("categories")
    .select("id").eq("type", "expense").limit(1).single();
  return { wid, a1: a1!.id, a2: a2!.id, cat: cat!.id };
}

describe("transactions CHECK", () => {
  it("aceita despesa e transferência válidas", async () => {
    const u = await createUser(); const s = await setup(u);
    const e1 = await u.client.from("transactions").insert({
      workspace_id: s.wid, type: "expense", amount_cents: 5000,
      date: "2026-06-01", account_id: s.a1, category_id: s.cat });
    expect(e1.error).toBeNull();
    const e2 = await u.client.from("transactions").insert({
      workspace_id: s.wid, type: "transfer", amount_cents: 2000,
      date: "2026-06-02", source_account_id: s.a1, dest_account_id: s.a2 });
    expect(e2.error).toBeNull();
  });
  it("rejeita transfer com categoria e amount<=0", async () => {
    const u = await createUser(); const s = await setup(u);
    const bad1 = await u.client.from("transactions").insert({
      workspace_id: s.wid, type: "transfer", amount_cents: 100, date: "2026-06-01",
      source_account_id: s.a1, dest_account_id: s.a2, category_id: s.cat });
    expect(bad1.error).not.toBeNull();
    const bad2 = await u.client.from("transactions").insert({
      workspace_id: s.wid, type: "income", amount_cents: 0, date: "2026-06-01",
      account_id: s.a1 });
    expect(bad2.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0007_transactions.sql`:
```sql
create type transaction_type as enum ('income','expense','transfer');

create table transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type transaction_type not null,
  amount_cents bigint not null,
  date date not null,
  account_id uuid references accounts(id),
  source_account_id uuid references accounts(id),
  dest_account_id uuid references accounts(id),
  category_id uuid references categories(id),
  description text,
  counterparty text,
  source text not null default 'manual',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint amount_positive check (amount_cents > 0),
  constraint tx_shape check (
    (type in ('income','expense')
       and account_id is not null
       and source_account_id is null and dest_account_id is null)
    or
    (type = 'transfer'
       and account_id is null and category_id is null
       and source_account_id is not null and dest_account_id is not null
       and source_account_id <> dest_account_id)
  )
);
create index transactions_workspace_date_idx on transactions(workspace_id, date);

alter table transactions enable row level security;
create policy tx_select on transactions for select using (is_member(workspace_id));
create policy tx_cud on transactions for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```
`supabase/migrations/0008_transaction_tags_fk.sql`:
```sql
alter table transaction_tags
  add constraint transaction_tags_tx_fk
  foreign key (transaction_id) references transactions(id) on delete cascade;
```

- [ ] **Step 4: Aplicar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- transactions.test` → PASS.

- [ ] **Step 5: e2e create/list com filtros (falha primeiro)** — `apps/api/test/e2e/transactions.e2e.test.ts`: cria conta+categoria via API, faz `POST /transactions` (despesa), `GET /transactions?from=&to=&accountId=&categoryId=&q=` e valida que o filtro por período exclui fora da janela. (Mesmo molde de bootstrap dos outros e2e.)

- [ ] **Step 6: Rodar e ver falhar.**

- [ ] **Step 7: Service com validações de app** — `apps/api/src/transactions/transactions.service.ts` (trechos-chave):
```ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { transactionInputSchema, type TransactionInput } from "@app/shared";
import { clientFromToken } from "../supabase/supabase-request";

@Injectable()
export class TransactionsService {
  async create(token: string, userId: string, body: unknown) {
    const dto: TransactionInput = transactionInputSchema.parse(body);
    const sb = clientFromToken(token);
    const { data: ws } = await sb.from("workspaces").select("id").limit(1).single();

    // valida que contas pertencem ao workspace e categoria casa com o tipo
    const accountIds = [dto.accountId, dto.sourceAccountId, dto.destAccountId].filter(Boolean) as string[];
    if (accountIds.length) {
      const { data: accs } = await sb.from("accounts").select("id").in("id", accountIds);
      if ((accs?.length ?? 0) !== accountIds.length)
        throw new BadRequestException("conta inexistente no workspace");
    }
    if (dto.categoryId) {
      const { data: cat } = await sb.from("categories")
        .select("type").eq("id", dto.categoryId).single();
      if (!cat) throw new BadRequestException("categoria inexistente");
      if (cat.type !== dto.type)
        throw new BadRequestException("categoria não casa com o tipo da transação");
    }

    const { data, error } = await sb.from("transactions").insert({
      workspace_id: ws!.id, type: dto.type, amount_cents: dto.amountCents, date: dto.date,
      account_id: dto.accountId ?? null,
      source_account_id: dto.sourceAccountId ?? null,
      dest_account_id: dto.destAccountId ?? null,
      category_id: dto.categoryId ?? null,
      description: dto.description ?? null, counterparty: dto.counterparty ?? null,
      source: "manual", created_by: userId,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async list(token: string, f: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string }) {
    const sb = clientFromToken(token);
    let query = sb.from("transactions").select("*").order("date", { ascending: false });
    if (f.from) query = query.gte("date", f.from);
    if (f.to) query = query.lte("date", f.to);
    if (f.categoryId) query = query.eq("category_id", f.categoryId);
    if (f.accountId) query = query.or(
      `account_id.eq.${f.accountId},source_account_id.eq.${f.accountId},dest_account_id.eq.${f.accountId}`);
    if (f.q) query = query.ilike("description", `%${f.q}%`);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }
}
```
Controller extrai `userId` do JWT (decodificar o `sub` do Bearer ou via `sb.auth.getUser(token)`), valida e delega. Registrar módulo no `app.module.ts`.

- [ ] **Step 8: Rodar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- transactions` → PASS.

- [ ] **Step 9: Commit** — `git commit -am "feat(transactions): table with shape CHECK, RLS, validated create and filtered list"`

---

## Task 6: Saldo derivado (view) — **task crítica**

**Files:** Create `supabase/migrations/0009_account_balances.sql`; `apps/api/src/balances/*`. Test: `apps/api/test/database/balances.test.ts`.

**Interfaces:**
- Consumes: `accounts`, `transactions`.
- Produces: view `account_balances`; `GET /balances` (por conta + consolidado). É onde o DoD "saldos batem" vive.

- [ ] **Step 1: Teste roteirizado (falha primeiro)**

`apps/api/test/database/balances.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createUser } from "../helpers/supabase";

describe("account_balances", () => {
  it("BAL1: saldos batem e transferência não vira gasto", async () => {
    const u = await createUser();
    const { data: ws } = await u.client.from("workspaces").select("id");
    const wid = ws![0].id;
    const mk = (type: string, name: string, open = 0) => u.client.from("accounts")
      .insert({ workspace_id: wid, type, name, opening_balance_cents: open }).select().single();
    const { data: c1 } = await mk("checking", "C1", 100_00);
    const { data: c2 } = await mk("savings", "C2", 0);
    const { data: cat } = await u.client.from("categories")
      .select("id").eq("type", "expense").limit(1).single();

    // +200 receita em C1, -50 despesa em C1, transfer 30 C1->C2
    await u.client.from("transactions").insert([
      { workspace_id: wid, type: "income",  amount_cents: 200_00, date: "2026-06-01", account_id: c1!.id },
      { workspace_id: wid, type: "expense", amount_cents: 50_00,  date: "2026-06-02", account_id: c1!.id, category_id: cat!.id },
      { workspace_id: wid, type: "transfer",amount_cents: 30_00,  date: "2026-06-03", source_account_id: c1!.id, dest_account_id: c2!.id },
    ]);

    const { data: bal } = await u.client.from("account_balances").select("*");
    const byId = Object.fromEntries(bal!.map(b => [b.account_id, b.balance_cents]));
    // C1: 100 +200 -50 -30 = 220 ; C2: 0 +30 = 30
    expect(byId[c1!.id]).toBe(220_00);
    expect(byId[c2!.id]).toBe(30_00);
    // consolidado = 250 (transfer é neutra no total)
    const total = bal!.reduce((s, b) => s + Number(b.balance_cents), 0);
    expect(total).toBe(250_00);
  });

  it("BAL2: não soma contas de outro workspace", async () => {
    const a = await createUser(); const b = await createUser();
    const { data: wsb } = await b.client.from("workspaces").select("id");
    await b.client.from("accounts").insert({
      workspace_id: wsb![0].id, type: "cash", name: "B", opening_balance_cents: 999_00 });
    const { data: aBal } = await a.client.from("account_balances").select("*");
    expect(aBal!.every(x => Number(x.balance_cents) !== 999_00)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `pnpm --filter @app/api test -- balances.test` → FAIL (view inexistente).

- [ ] **Step 3: Migration da view** — `supabase/migrations/0009_account_balances.sql`:
```sql
create view account_balances
with (security_invoker = true) as
select
  a.id as account_id,
  a.workspace_id,
  a.opening_balance_cents
  + coalesce(sum(case
      when t.type = 'income'   and t.account_id = a.id        then t.amount_cents
      when t.type = 'expense'  and t.account_id = a.id        then -t.amount_cents
      when t.type = 'transfer' and t.dest_account_id = a.id   then t.amount_cents
      when t.type = 'transfer' and t.source_account_id = a.id then -t.amount_cents
      else 0 end), 0) as balance_cents
from accounts a
left join transactions t
  on t.workspace_id = a.workspace_id
 and (t.account_id = a.id or t.source_account_id = a.id or t.dest_account_id = a.id)
group by a.id, a.workspace_id, a.opening_balance_cents;
```
> `security_invoker=true` faz a view respeitar a RLS do chamador sobre `accounts`/`transactions` (Postgres 15+). Cada transação contribui uma vez por conta que toca; transferência entra com sinais opostos nas duas contas, neutra no total.

- [ ] **Step 4: Aplicar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- balances.test` → PASS.

- [ ] **Step 5: Endpoint** — `GET /balances` retorna `{ accounts: [{account_id, balance_cents}], consolidatedCents }` somando a view (apenas contas não arquivadas via join/filtro). e2e mínimo opcional.

- [ ] **Step 6: Commit** — `git commit -am "feat(balances): derived account_balances view (security_invoker) and endpoint"`

---

## Task 7: Dashboard — RPCs e agregações

**Files:** Create `supabase/migrations/0010_dashboard_rpcs.sql`; `apps/api/src/dashboard/*`. Test: `apps/api/test/database/dashboard.test.ts`.

**Interfaces:** Produces RPCs `month_cashflow`, `month_category_breakdown`, `cashflow_series`; `GET /dashboard?month=`. Transferências **excluídas** dos gastos.

- [ ] **Step 1: Teste (falha primeiro)** — `apps/api/test/database/dashboard.test.ts`: semeia income 300 + expense 80 + transfer 50 num mês; chama `rpc('month_cashflow', { p_workspace, p_month })` e espera `income_cents=30000, expense_cents=8000` (transfer **fora**); `month_category_breakdown` retorna a categoria de despesa com 8000; `cashflow_series` com 3 meses retorna 3 linhas.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration das RPCs** — `supabase/migrations/0010_dashboard_rpcs.sql`:
```sql
create or replace function month_cashflow(p_workspace uuid, p_month date)
returns table (income_cents bigint, expense_cents bigint)
language sql stable security invoker set search_path = public as $$
  select
    coalesce(sum(amount_cents) filter (where type='income'), 0),
    coalesce(sum(amount_cents) filter (where type='expense'), 0)
  from transactions
  where workspace_id = p_workspace and is_member(p_workspace)
    and date >= date_trunc('month', p_month)
    and date <  (date_trunc('month', p_month) + interval '1 month');
$$;

create or replace function month_category_breakdown(p_workspace uuid, p_month date, p_type transaction_type)
returns table (category_id uuid, name text, total_cents bigint)
language sql stable security invoker set search_path = public as $$
  select c.id, c.name, sum(t.amount_cents)
  from transactions t join categories c on c.id = t.category_id
  where t.workspace_id = p_workspace and is_member(p_workspace)
    and t.type = p_type
    and t.date >= date_trunc('month', p_month)
    and t.date <  (date_trunc('month', p_month) + interval '1 month')
  group by c.id, c.name
  order by sum(t.amount_cents) desc;
$$;

create or replace function cashflow_series(p_workspace uuid, p_months int)
returns table (month date, income_cents bigint, expense_cents bigint)
language sql stable security invoker set search_path = public as $$
  with months as (
    select date_trunc('month', (current_date - (g || ' months')::interval))::date as m
    from generate_series(0, greatest(p_months,1) - 1) g
  )
  select m.m,
    coalesce(sum(t.amount_cents) filter (where t.type='income'),0),
    coalesce(sum(t.amount_cents) filter (where t.type='expense'),0)
  from months m
  left join transactions t
    on t.workspace_id = p_workspace
   and date_trunc('month', t.date)::date = m.m
  where is_member(p_workspace)
  group by m.m order by m.m;
$$;
```
> `is_member(p_workspace)` no `where` garante que um chamador não agregue workspace alheio mesmo via RPC.

- [ ] **Step 4: Aplicar e ver passar.**

- [ ] **Step 5: Endpoint** — `GET /dashboard?month=YYYY-MM-01` monta os 4 widgets (consolidado da Task 6 + as 3 RPCs).

- [ ] **Step 6: Commit** — `git commit -am "feat(dashboard): cashflow/category/series RPCs excluding transfers"`

---

## Task 8: Web — contas, lançamento rápido, listagem, dashboard

**Files:** Create em `apps/web/src/`: `lib/api.ts`, `stores/finance.ts`, `views/AccountsView.vue`, `components/QuickEntryForm.vue`, `views/TransactionsView.vue`, `views/DashboardView.vue`. Test: `src/components/__tests__/quick-entry.test.ts`.

**Interfaces:** Consumes endpoints das Tasks 2–7. Produces UI utilizável.

- [ ] **Step 1: Cliente de API** — `apps/web/src/lib/api.ts`: wrapper `fetch` que injeta `Authorization: Bearer <token do auth store>` e aponta para `VITE_API_URL`.

- [ ] **Step 2: Teste do form (falha primeiro)** — `quick-entry.test.ts`: ao escolher `type=transfer`, o form mostra origem+destino e **esconde** categoria; `buildPayload()` não inclui `categoryId` em transfer e bloqueia origem=destino. (Testa a lógica condicional, espelho do `transactionInputSchema`.)

- [ ] **Step 3: Rodar e ver falhar.**

- [ ] **Step 4: `QuickEntryForm.vue`** — 3 abas (Receita/Despesa/Transferência); campos condicionais; valida com `transactionInputSchema` de `@app/shared` antes de enviar `POST /transactions`.

- [ ] **Step 5: Rodar e ver passar.**

- [ ] **Step 6: Telas restantes (verificação manual)** — `AccountsView` (criar/listar/arquivar + saldo de `GET /balances`), `TransactionsView` (listagem + filtros período/conta/categoria/busca), `DashboardView` (4 widgets via `GET /dashboard`; gráfico com ECharts/Chart.js). Rodar `pnpm --filter @app/web dev` e validar o fluxo ponta a ponta.

- [ ] **Step 7: Commit** — `git commit -am "feat(web): accounts, quick-entry, transactions list and dashboard"`

---

## Self-review (feito)

- **Cobertura do DoD:** saldos batem (Task 6/BAL1) · transfer fora do gasto (Tasks 6 e 7) · 4 widgets (Tasks 6–8) · filtros (Task 5/Task 8) · RLS em tabelas novas (Tasks 2–5).
- **Consistência:** tipos de `@app/shared` (Task 1) batem com colunas/CHECK das migrations; `transactionInputSchema` espelha o CHECK `tx_shape`; categoria×tipo validada no app (Task 5).
- **Ordem de migrations:** 0004 accounts · 0005 categories · 0006 tags · 0007 transactions · 0008 fk tag→tx · 0009 view saldo · 0010 RPCs. (0008 depois de 0007 porque a FK referencia `transactions`.)
- **Pontos de atenção:** (a) `security_invoker` na view exige Postgres 15+ (padrão no Supabase atual); (b) `workspaces ... limit(1)` assume workspace único da Fase 1 — trocar por `workspace_id` explícito na Fase 5.

---

## Execução

Mesma escolha da Fase 0: **subagent-driven** (recomendado) via `superpowers:subagent-driven-development`, com review por task — atenção redobrada na **Task 6 (saldo)**, que é onde o DoD vive. Dependências sequenciais: 1 → (2,3,4) → 5 → 6 → 7 → 8.
