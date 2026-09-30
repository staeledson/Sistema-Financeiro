# Fase 10 — Modelo PF/PJ · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada conta bancária passa a ter entidade (PF ou PJ), instituição e, no cartão de crédito, dia de fechamento, dia de vencimento e limite. Categorias ganham escopo por entidade (com categorias PJ de fábrica), o workspace ganha configurações (`WorkspaceSettings`) e as telas de Contas e Transações permitem cadastrar, editar e filtrar por PF/PJ.

**Architecture:** Uma migration aditiva (enums, colunas com padrão, tabela `workspace_settings`, categorias PJ para workspaces existentes) mais os schemas Zod correspondentes em `packages/shared`. A API estende `accounts`, `categories` e `transactions` (filtro `entity`) e ganha `GET/PATCH /workspaces/current/settings`. Um filtro global converte `ZodError` em HTTP 400 (hoje vira 500). O front ganha helpers puros testáveis (`lib/entity.ts`, `lib/account-form.ts`), um componente de campos de conta compartilhado por criação e edição, e o filtro PF/PJ nas telas de Contas e Transações.

**Tech Stack:** pnpm 11 + Turborepo, NestJS 11 + Fastify 5, Prisma 7 (clients gerados em `apps/api/generated/prisma` e `apps/worker/generated/prisma`), Zod 3, Vue 3.5 + Vite + Pinia, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-contas-pf-pj-import-ia-dashboards-design.md`, seções 3.1, 3.3 e 3.5, e fase 2 da seção 10.

## Global Constraints

- Branch de trabalho: `fase-10-modelo-pf-pj`, criada a partir de `main` (Task 1, Step 1). Merge em `main` só com testes verdes.
- Portas locais: Postgres `5433`, Redis `6380`, MinIO `9010`/`9011`, API `3100`, Web `5173`. Nunca 5432/6379/9000/3000.
- Infra precisa estar no ar para os testes da API: `docker compose up -d` (se a 5433 estiver ocupada por outro projeto, pare o outro container primeiro).
- Valores dos enums, copiados da spec: `AccountEntity { pf, pj }`, `Institution { bb, inter, mercado_pago, c6, other }`, `CategoryEntity { pf, pj, both }`.
- `BankAccount`: `entity` (obrigatório, contas existentes viram `pf`), `institution` (padrão `other`), `externalId String?`, `closingDay Int?` (1–31), `dueDay Int?` (1–31), `creditLimitCents BigInt?`. `closingDay`, `dueDay` e `creditLimitCents` só são aceitos quando `type = credit_card`.
- `Category.entity`: `CategoryEntity`, padrão `both`. A tela lista categorias cujo `entity` seja `both` ou igual ao da conta.
- Categorias PJ de fábrica (`entity = pj`): despesas Pró-labore, Impostos e tributos, Fornecedores, Serviços contratados, Tarifas bancárias, Folha e terceiros; receita Receita de serviços.
- `WorkspaceSettings` (1:1 com Workspace): `aiConfidenceThreshold Float @default(0.8)`, `aiBatchSize Int @default(40)`, `transferMatchWindowDays Int @default(2)`, `ownerNames String[] @default([])`.
- Fora desta fase (não tocar): campos novos de `Transaction` (fase 12), campos novos de `ImportBatch` e fingerprint (fase 11), cálculo de saldo em SQL e dashboards (fase 13).
- Migrations não usam `prisma migrate dev`. O SQL é gerado por `prisma migrate diff` e o passo de dados é escrito à mão (Task 1).
- Commits pequenos, mensagens em português no padrão `tipo(escopo): descrição`, sempre terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Comandos rodam a partir da raiz do repositório salvo indicação. Nunca usar `pnpm --filter … test run` (vira `vitest run run`); usar `pnpm --filter … test`.
- Testes e2e da API compartilham o banco `financas` e rodam em série; `cleanDb()` apaga tudo. Não guarde dados de desenvolvimento nesse banco.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `prisma/schema.prisma` | modificar | enums, campos novos, `WorkspaceSettings` |
| `prisma/migrations/20260930120000_fase10_modelo_pf_pj/migration.sql` | criar | DDL gerado + categorias PJ para workspaces existentes |
| `packages/shared/src/enums.ts` | modificar | `ACCOUNT_ENTITIES`, `INSTITUTIONS`, `CATEGORY_ENTITIES` |
| `packages/shared/src/finance.ts` | modificar | `accountSchema`, `accountUpdateSchema`, `cardFieldsPresent`, `categorySchema.entity` |
| `packages/shared/src/settings.ts` | criar | schemas e padrões de `WorkspaceSettings` |
| `packages/shared/src/index.ts` | modificar | exporta `settings` e `ZodError` |
| `packages/shared/src/__tests__/account-entity.test.ts` | criar | testes unitários dos schemas |
| `apps/api/src/common/zod-exception.filter.ts` | criar | `ZodError` → HTTP 400 |
| `apps/api/src/common/entity-query.ts` | criar | `parseEntityQuery` para `?entity=` |
| `apps/api/src/app.module.ts` | modificar | registra o filtro global |
| `apps/api/src/accounts/*` | modificar | campos novos, `PATCH /accounts/:id`, filtro `entity` |
| `apps/api/src/categories/seed-categories.ts` | modificar | fonte única das categorias de fábrica (com PJ) |
| `apps/api/src/auth/index.ts` | modificar | usa a fonte única em vez da lista duplicada |
| `apps/api/src/categories/categories.{controller,service}.ts` | modificar | `entity` em create/update/list |
| `apps/api/src/transactions/transactions.{controller,service}.ts` | modificar | filtro `entity` |
| `apps/api/src/workspaces/workspace-settings.{controller,service}.ts` | criar | `GET/PATCH /workspaces/current/settings` |
| `apps/api/src/workspaces/workspaces.module.ts` | modificar | registra controller e service novos |
| `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts` | criar | e2e da fase (um `describe` por task de API) |
| `apps/api/test/e2e/finance.e2e.test.ts` | modificar | teste T3 passa a contar por entidade |
| `apps/api/test/database/schema.test.ts` | modificar | colunas e tabela novas |
| `apps/web/src/lib/entity.ts` | criar | tipos, rótulos e filtros puros |
| `apps/web/src/lib/account-form.ts` | criar | estado do formulário e payloads |
| `apps/web/src/lib/api.ts` | modificar | tipos e chamadas com entidade |
| `apps/web/src/stores/finance.ts` | modificar | `updateAccount` |
| `apps/web/src/components/AccountFields.vue` | criar | campos de conta (criação e edição) |
| `apps/web/src/views/AccountsView.vue` | reescrever | filtro PF/PJ, campos novos, edição |
| `apps/web/src/views/TransactionsView.vue` | modificar | filtro PF/PJ, categorias por entidade da conta |
| `apps/web/src/lib/__tests__/{entity,account-form,api-entity}.test.ts` | criar | testes do front |
| `README.md` | modificar | contagens e modelos |

---

### Task 1: Modelo de dados, migration e schemas compartilhados

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260930120000_fase10_modelo_pf_pj/migration.sql`
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/finance.ts`
- Create: `packages/shared/src/settings.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/account-entity.test.ts`
- Modify: `apps/api/test/database/schema.test.ts`

**Interfaces:**
- Produces (em `@app/shared`):
  - `ACCOUNT_ENTITIES`, `type AccountEntity = "pf" | "pj"`
  - `INSTITUTIONS`, `type Institution = "bb" | "inter" | "mercado_pago" | "c6" | "other"`
  - `CATEGORY_ENTITIES`, `type CategoryEntity = "pf" | "pj" | "both"`
  - `accountSchema` (saída: `entity: AccountEntity`, `institution: Institution`, `externalId?: string | null`, `closingDay?: number | null`, `dueDay?: number | null`, `creditLimitCents?: number | null`), `type AccountInput`
  - `accountUpdateSchema` (todos os campos opcionais: `name`, `entity`, `institution`, `externalId`, `closingDay`, `dueDay`, `creditLimitCents`), `type AccountUpdateInput`
  - `CARD_ONLY_FIELDS`, `cardFieldsPresent(dto): boolean`
  - `categorySchema` ganha `entity: CategoryEntity` (padrão `both`)
  - `workspaceSettingsSchema`, `workspaceSettingsUpdateSchema`, `DEFAULT_WORKSPACE_SETTINGS`, `type WorkspaceSettingsInput`
  - `ZodError` (reexportado de `zod`, para o filtro da API usar a mesma instância dos schemas)
- Produces (Prisma): enums `AccountEntity`, `Institution`, `CategoryEntity`; campos em `BankAccount` e `Category`; model `WorkspaceSettings` (tabela `workspace_settings`).

- [x] **Step 1: Criar a branch**

```bash
git checkout main
git pull --ff-only origin main
git checkout -b fase-10-modelo-pf-pj
```

Esperado: `Switched to a new branch 'fase-10-modelo-pf-pj'`.

- [x] **Step 2: Escrever os testes unitários dos schemas (devem falhar)**

Criar `packages/shared/src/__tests__/account-entity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  accountSchema,
  accountUpdateSchema,
  categorySchema,
  cardFieldsPresent,
  workspaceSettingsSchema,
  workspaceSettingsUpdateSchema,
  DEFAULT_WORKSPACE_SETTINGS,
} from "../index";

describe("accountSchema — entidade e instituição", () => {
  it("aplica os padrões entity=pf, institution=other e saldo 0", () => {
    const r = accountSchema.parse({ type: "checking", name: "Conta" });
    expect(r.entity).toBe("pf");
    expect(r.institution).toBe("other");
    expect(r.openingBalanceCents).toBe(0);
  });

  it("aceita cartão PJ do C6 com fechamento, vencimento e limite", () => {
    const r = accountSchema.parse({
      type: "credit_card",
      name: "C6 Empresa",
      entity: "pj",
      institution: "c6",
      externalId: "1234",
      closingDay: 10,
      dueDay: 17,
      creditLimitCents: 500000,
    });
    expect(r).toMatchObject({ entity: "pj", institution: "c6", closingDay: 10, dueDay: 17, creditLimitCents: 500000 });
  });

  it("rejeita dados de cartão em conta que não é cartão", () => {
    expect(() => accountSchema.parse({ type: "checking", name: "X", closingDay: 10 })).toThrow();
    expect(() => accountSchema.parse({ type: "savings", name: "X", creditLimitCents: 1000 })).toThrow();
  });

  it("aceita campos de cartão nulos em conta que não é cartão", () => {
    const r = accountSchema.parse({ type: "checking", name: "X", closingDay: null, dueDay: null, creditLimitCents: null });
    expect(r.closingDay).toBeNull();
  });

  it("rejeita dia de fechamento ou vencimento fora de 1–31", () => {
    const base = { type: "credit_card", name: "Cartão" };
    expect(() => accountSchema.parse({ ...base, closingDay: 0 })).toThrow();
    expect(() => accountSchema.parse({ ...base, closingDay: 32 })).toThrow();
    expect(() => accountSchema.parse({ ...base, dueDay: 40 })).toThrow();
  });

  it("rejeita entidade e instituição inválidas", () => {
    expect(() => accountSchema.parse({ type: "checking", name: "X", entity: "xx" })).toThrow();
    expect(() => accountSchema.parse({ type: "checking", name: "X", institution: "nubank" })).toThrow();
  });
});

describe("accountUpdateSchema", () => {
  it("aceita atualização parcial", () => {
    expect(accountUpdateSchema.parse({ entity: "pj" })).toEqual({ entity: "pj" });
    expect(accountUpdateSchema.parse({})).toEqual({});
  });

  it("rejeita entidade inválida e nome vazio", () => {
    expect(() => accountUpdateSchema.parse({ entity: "xx" })).toThrow();
    expect(() => accountUpdateSchema.parse({ name: "" })).toThrow();
  });

  it("permite limpar o externalId com null", () => {
    expect(accountUpdateSchema.parse({ externalId: null })).toEqual({ externalId: null });
  });
});

describe("cardFieldsPresent", () => {
  it("detecta qualquer campo de cartão preenchido", () => {
    expect(cardFieldsPresent({})).toBe(false);
    expect(cardFieldsPresent({ closingDay: null, dueDay: null })).toBe(false);
    expect(cardFieldsPresent({ dueDay: 5 })).toBe(true);
    expect(cardFieldsPresent({ creditLimitCents: 0 })).toBe(true);
  });
});

describe("categorySchema — entity", () => {
  it("usa both como padrão e aceita pf e pj", () => {
    expect(categorySchema.parse({ type: "expense", name: "X" }).entity).toBe("both");
    expect(categorySchema.parse({ type: "expense", name: "X", entity: "pj" }).entity).toBe("pj");
  });

  it("rejeita entity inválida", () => {
    expect(() => categorySchema.parse({ type: "expense", name: "X", entity: "xx" })).toThrow();
  });

  it("partial() não reaplica o padrão both em atualizações", () => {
    expect(categorySchema.partial().parse({ name: "Novo" })).toEqual({ name: "Novo" });
  });
});

describe("workspaceSettingsSchema", () => {
  it("expõe os padrões da spec", () => {
    expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({
      aiConfidenceThreshold: 0.8,
      aiBatchSize: 40,
      transferMatchWindowDays: 2,
      ownerNames: [],
    });
    expect(workspaceSettingsSchema.parse(DEFAULT_WORKSPACE_SETTINGS)).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("rejeita limiar fora de 0–1, lote inválido e janela negativa", () => {
    expect(() => workspaceSettingsUpdateSchema.parse({ aiConfidenceThreshold: 1.5 })).toThrow();
    expect(() => workspaceSettingsUpdateSchema.parse({ aiBatchSize: 0 })).toThrow();
    expect(() => workspaceSettingsUpdateSchema.parse({ transferMatchWindowDays: -1 })).toThrow();
  });

  it("apara os nomes do titular e rejeita nome vazio", () => {
    expect(workspaceSettingsUpdateSchema.parse({ ownerNames: ["  Stael Edson  "] })).toEqual({ ownerNames: ["Stael Edson"] });
    expect(() => workspaceSettingsUpdateSchema.parse({ ownerNames: ["   "] })).toThrow();
  });
});
```

- [x] **Step 3: Rodar e confirmar a falha**

```bash
pnpm --filter @app/shared test
```

Esperado: FAIL no novo arquivo (`accountUpdateSchema`/`cardFieldsPresent`/`workspaceSettingsSchema` não exportados, ou `TypeError ... is not a function`). Os testes antigos continuam passando.

- [x] **Step 4: Implementar enums e schemas compartilhados**

Em `packages/shared/src/enums.ts`, acrescentar ao final:

```ts
export const ACCOUNT_ENTITIES = ["pf", "pj"] as const;
export type AccountEntity = (typeof ACCOUNT_ENTITIES)[number];

export const INSTITUTIONS = ["bb", "inter", "mercado_pago", "c6", "other"] as const;
export type Institution = (typeof INSTITUTIONS)[number];

export const CATEGORY_ENTITIES = ["pf", "pj", "both"] as const;
export type CategoryEntity = (typeof CATEGORY_ENTITIES)[number];
```

Em `packages/shared/src/finance.ts`, trocar a primeira linha de import e os dois schemas `accountSchema` e `categorySchema` (o restante do arquivo fica como está):

```ts
import { z } from "zod";
import {
  ACCOUNT_ENTITIES,
  ACCOUNT_TYPES,
  CATEGORY_ENTITIES,
  CATEGORY_TYPES,
  INSTITUTIONS,
  TRANSACTION_TYPES,
} from "./enums";

/** Campos que só fazem sentido em cartão de crédito. */
export const CARD_ONLY_FIELDS = ["closingDay", "dueDay", "creditLimitCents"] as const;

const cardFieldShape = {
  closingDay: z.number().int().min(1).max(31).nullish(),
  dueDay: z.number().int().min(1).max(31).nullish(),
  creditLimitCents: z.number().int().nonnegative().nullish(),
};

export function cardFieldsPresent(
  dto: Partial<Record<(typeof CARD_ONLY_FIELDS)[number], number | null | undefined>>,
): boolean {
  return CARD_ONLY_FIELDS.some((k) => dto[k] != null);
}

export const accountSchema = z
  .object({
    type: z.enum(ACCOUNT_TYPES),
    name: z.string().min(1),
    openingBalanceCents: z.number().int().default(0),
    entity: z.enum(ACCOUNT_ENTITIES).default("pf"),
    institution: z.enum(INSTITUTIONS).default("other"),
    externalId: z.string().min(1).nullish(),
    ...cardFieldShape,
  })
  .superRefine((v, ctx) => {
    if (v.type !== "credit_card" && cardFieldsPresent(v))
      ctx.addIssue({ code: "custom", message: "closingDay, dueDay e creditLimitCents só valem para cartão de crédito" });
  });

export const accountUpdateSchema = z
  .object({
    name: z.string().min(1),
    entity: z.enum(ACCOUNT_ENTITIES),
    institution: z.enum(INSTITUTIONS),
    externalId: z.string().min(1).nullable(),
    ...cardFieldShape,
  })
  .partial();

export const categorySchema = z.object({
  type: z.enum(CATEGORY_TYPES),
  name: z.string().min(1),
  parentId: z.string().min(1).nullish(),
  icon: z.string().nullish(),
  color: z.string().nullish(),
  entity: z.enum(CATEGORY_ENTITIES).default("both"),
});
```

Ainda em `finance.ts`, no bloco de tipos do final, acrescentar `AccountUpdateInput` ao lado de `AccountInput`:

```ts
export type AccountInput = z.infer<typeof accountSchema>;
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
```

Criar `packages/shared/src/settings.ts`:

```ts
import { z } from "zod";

export const workspaceSettingsSchema = z.object({
  aiConfidenceThreshold: z.number().min(0).max(1),
  aiBatchSize: z.number().int().min(1).max(200),
  transferMatchWindowDays: z.number().int().min(0).max(10),
  ownerNames: z.array(z.string().trim().min(1)).max(20),
});

export const workspaceSettingsUpdateSchema = workspaceSettingsSchema.partial();

export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>;

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettingsInput = {
  aiConfidenceThreshold: 0.8,
  aiBatchSize: 40,
  transferMatchWindowDays: 2,
  ownerNames: [],
};
```

Substituir `packages/shared/src/index.ts` por:

```ts
export const PING = "pong";
export * from "./enums";
export * from "./workspace";
export * from "./finance";
export * from "./import";
export * from "./ofx";
export * from "./rules";
export * from "./settings";
// Mesma instância de ZodError dos schemas: o filtro da API usa `instanceof`.
export { ZodError } from "zod";
```

- [x] **Step 5: Rodar os testes do shared e confirmar que passam**

```bash
pnpm --filter @app/shared test
```

Esperado: todos os arquivos passam (antes eram 32 testes; agora 32 + 16 novos).

- [x] **Step 6: Escrever o teste de schema do banco (deve falhar)**

Em `apps/api/test/database/schema.test.ts`, acrescentar dentro do `describe("schema base", …)`, depois do último `it`:

```ts
  it("bank_accounts tem as colunas do modelo PF/PJ", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'bank_accounts'`;
    const cols = rows.map((r) => r.column_name);
    for (const c of ["entity", "institution", "externalId", "closingDay", "dueDay", "creditLimitCents"]) {
      expect(cols).toContain(c);
    }
  });

  it("categories tem entity e workspace_settings existe", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'categories'`;
    expect(rows.map((r) => r.column_name)).toContain("entity");
    expect(await prisma.workspaceSettings.count()).toBeGreaterThanOrEqual(0);
  });
```

- [x] **Step 7: Rodar e confirmar a falha**

```bash
docker compose up -d
pnpm --filter @app/api exec vitest run test/database/schema.test.ts
```

Esperado: FAIL nos dois testes novos (colunas inexistentes; `prisma.workspaceSettings` indefinido).

- [x] **Step 8: Editar o `prisma/schema.prisma`**

1. Logo antes do `model BankAccount`, junto dos demais enums, acrescentar:

```prisma
enum AccountEntity {
  pf
  pj
}

enum Institution {
  bb
  inter
  mercado_pago
  c6
  other
}

enum CategoryEntity {
  pf
  pj
  both
}
```

2. Substituir o bloco `model BankAccount { … }` inteiro por:

```prisma
model BankAccount {
  id                  String        @id @default(cuid())
  workspaceId         String
  workspace           Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  type                AccountType
  name                String
  openingBalanceCents BigInt        @default(0)
  archived            Boolean       @default(false)
  entity              AccountEntity @default(pf)
  institution         Institution   @default(other)
  externalId          String?
  closingDay          Int?
  dueDay              Int?
  creditLimitCents    BigInt?
  createdAt           DateTime      @default(now())

  transactions       Transaction[]      @relation("TransactionAccount")
  sourceTransactions Transaction[]      @relation("TransactionSource")
  destTransactions   Transaction[]      @relation("TransactionDest")
  drafts             TransactionDraft[]
  importBatches      ImportBatch[]

  @@index([workspaceId])
  @@index([workspaceId, entity])
  @@map("bank_accounts")
}
```

3. No `model Category`, acrescentar a linha `entity CategoryEntity @default(both)` logo depois de `isSystem`:

```prisma
  isSystem    Boolean      @default(false)
  entity      CategoryEntity @default(both)
```

4. No `model Workspace`, acrescentar ao fim da lista de relações (antes do `@@map("workspaces")`):

```prisma
  settings         WorkspaceSettings?
```

5. Ao final do arquivo, acrescentar:

```prisma
model WorkspaceSettings {
  workspaceId             String    @id
  workspace               Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  aiConfidenceThreshold   Float     @default(0.8)
  aiBatchSize             Int       @default(40)
  transferMatchWindowDays Int       @default(2)
  ownerNames              String[]  @default([])
  updatedAt               DateTime  @updatedAt

  @@map("workspace_settings")
}
```

- [x] **Step 9: Gerar o SQL da migration a partir do diff**

O `HEAD` ainda tem o schema antigo (nada foi commitado). O diff entre ele e o schema editado é exatamente o DDL da fase.

```bash
git show HEAD:prisma/schema.prisma > "$TMPDIR/old.prisma"
mkdir -p prisma/migrations/20260930120000_fase10_modelo_pf_pj
pnpm exec prisma migrate diff \
  --from-schema "$TMPDIR/old.prisma" \
  --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/20260930120000_fase10_modelo_pf_pj/migration.sql
grep -cE 'CREATE TYPE|ALTER TABLE|CREATE TABLE|CREATE INDEX' prisma/migrations/20260930120000_fase10_modelo_pf_pj/migration.sql
```

Esperado: o arquivo contém três `CREATE TYPE` (AccountEntity, Institution, CategoryEntity), `ALTER TABLE "bank_accounts"` e `"categories"`, `CREATE TABLE "workspace_settings"`, `CREATE INDEX` de `bank_accounts` e uma `FOREIGN KEY` de `workspace_settings`. O `grep -c` imprime um número maior que 6. Abrir o arquivo e conferir que não há `DROP`.

- [x] **Step 10: Acrescentar ao SQL o passo de dados (categorias PJ para workspaces existentes)**

```bash
cat >> prisma/migrations/20260930120000_fase10_modelo_pf_pj/migration.sql <<'SQL'

-- Dados: categorias PJ de fábrica para os workspaces que já existem
INSERT INTO "categories" ("id", "workspaceId", "type", "name", "isSystem", "entity")
SELECT
  'c' || md5(w."id" || '|' || v."name"),
  w."id",
  v."type"::"CategoryType",
  v."name",
  true,
  'pj'::"CategoryEntity"
FROM "workspaces" w
CROSS JOIN (VALUES
  ('income',  'Receita de serviços'),
  ('expense', 'Pró-labore'),
  ('expense', 'Impostos e tributos'),
  ('expense', 'Fornecedores'),
  ('expense', 'Serviços contratados'),
  ('expense', 'Tarifas bancárias'),
  ('expense', 'Folha e terceiros')
) AS v("type", "name");
SQL
tail -5 prisma/migrations/20260930120000_fase10_modelo_pf_pj/migration.sql
```

- [x] **Step 11: Criar dados "antigos" e aplicar a migration**

Garantir um workspace criado antes da migration (para provar o passo de dados). As linhas abaixo usam ids fixos `pre10` e o `on conflict` torna o passo repetível:

```bash
docker exec financas-postgres psql -U app -d financas <<'SQL'
insert into "user"(id, name, email, "emailVerified", "createdAt", "updatedAt")
  values ('u_pre10', 'Pré Fase 10', 'pre10@test.com', false, now(), now()) on conflict do nothing;
insert into workspaces(id, type, name, "createdById", "updatedAt")
  values ('w_pre10', 'personal', 'Pré Fase 10', 'u_pre10', now()) on conflict do nothing;
insert into bank_accounts(id, "workspaceId", type, name)
  values ('a_pre10', 'w_pre10', 'checking', 'Conta antiga') on conflict do nothing;
SQL
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

Esperado: `Applying migration '20260930120000_fase10_modelo_pf_pj'` e `All migrations have been successfully applied`; `generate` gera os dois clients.

- [x] **Step 12: Verificar o passo de dados e o padrão das contas antigas**

```bash
docker exec financas-postgres psql -U app -d financas -c "
select (select entity from bank_accounts where id='a_pre10') as conta_antiga_entity,
       (select institution from bank_accounts where id='a_pre10') as conta_antiga_institution,
       (select count(*) from categories where \"workspaceId\"='w_pre10' and entity='pj') as categorias_pj,
       (select count(*) from categories where entity='pj' and \"isSystem\") >= 7 * (select count(*) from workspaces) as todos_workspaces_cobertos;"
```

Esperado: `pf`, `other`, `7` e `t`.

Conferir que o banco e o schema coincidem (sem drift):

```bash
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script | tail -2
```

Esperado: `-- This is an empty migration.`

Limpar os dados de teste (o `ON DELETE CASCADE` remove workspace, conta e categorias):

```bash
docker exec financas-postgres psql -U app -d financas -c "delete from \"user\" where id='u_pre10';"
```

- [x] **Step 13: Rodar testes e typecheck**

```bash
pnpm --filter @app/api exec vitest run test/database/schema.test.ts
pnpm turbo typecheck
```

Esperado: 4 testes passam em `schema.test.ts`; typecheck verde nos 4 pacotes. (Se o typecheck do web ou da API falhar por tipos dos enums gerados, rodar `pnpm exec prisma generate` de novo.)

- [x] **Step 14: Commit**

```bash
git add prisma packages/shared apps/api/test/database/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): entidade PF/PJ, instituição, dados de cartão, escopo de categoria e WorkspaceSettings

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: API de contas (campos novos, edição, filtro) e filtro global de validação

**Files:**
- Create: `apps/api/src/common/zod-exception.filter.ts`
- Create: `apps/api/src/common/entity-query.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/accounts/accounts.service.ts`
- Modify: `apps/api/src/accounts/accounts.controller.ts`
- Create: `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`

**Interfaces:**
- Consumes (Task 1): `accountSchema`, `accountUpdateSchema`, `cardFieldsPresent`, `ACCOUNT_ENTITIES`, `ZodError`, tipos `AccountEntity`, `AccountUpdateInput` de `@app/shared`.
- Produces:
  - `ZodExceptionFilter` (registrado globalmente): qualquer `ZodError` vira HTTP 400 com corpo `{ statusCode: 400, error: "Bad Request", message: string[] }`.
  - `parseEntityQuery(value?: string): AccountEntity | undefined` em `apps/api/src/common/entity-query.ts`: lança `BadRequestException("entity deve ser pf ou pj")` se o valor for diferente de `pf`/`pj`.
  - `GET /accounts?entity=pf|pj` filtra; `POST /accounts` e `PATCH /accounts/:id` aceitam `entity`, `institution`, `externalId`, `closingDay`, `dueDay`, `creditLimitCents`. Toda resposta de conta traz: `id, type, name, openingBalanceCents, archived, entity, institution, externalId, closingDay, dueDay, creditLimitCents`.
  - Helper de teste `newUser(tag)` em `modelo-pf-pj.e2e.test.ts` retornando `{ userId: string; workspaceId: string; h: { authorization: string; "content-type": string } }`; usado pelas Tasks 3, 4 e 5.

- [x] **Step 1: Escrever os testes e2e de contas (devem falhar)**

Criar `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`:

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
  return {
    userId: u!.user.id,
    workspaceId: ws.id,
    h: { authorization: `Bearer ${u!.token}`, "content-type": "application/json" },
  };
}

describe("Fase 10 — contas PF/PJ", () => {
  it("conta criada sem entity vira pf/other e sem dados de cartão", async () => {
    const u = await newUser("acc1");
    const res = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Nubank" } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      entity: "pf", institution: "other", externalId: null, closingDay: null, dueDay: null, creditLimitCents: null,
    });
  });

  it("cria cartão PJ do C6 com fechamento, vencimento e limite", async () => {
    const u = await newUser("acc2");
    const res = await app.inject({
      method: "POST", url: "/accounts", headers: u.h,
      payload: {
        type: "credit_card", name: "C6 Empresa", entity: "pj", institution: "c6",
        externalId: "1234", closingDay: 10, dueDay: 17, creditLimitCents: 500000,
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      entity: "pj", institution: "c6", externalId: "1234", closingDay: 10, dueDay: 17, creditLimitCents: 500000,
    });
  });

  it("rejeita dado de cartão em conta corrente com 400", async () => {
    const u = await newUser("acc3");
    const res = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "X", closingDay: 10 } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().message)).toContain("cartão de crédito");
  });

  it("rejeita entity inválida com 400", async () => {
    const u = await newUser("acc4");
    const res = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "X", entity: "xx" } });
    expect(res.statusCode).toBe(400);
  });

  it("GET /accounts?entity filtra por entidade", async () => {
    const u = await newUser("acc5");
    await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta PF", entity: "pf" } });
    await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta PJ", entity: "pj" } });

    const all = await app.inject({ method: "GET", url: "/accounts", headers: u.h });
    expect(all.json().map((a: { name: string }) => a.name).sort()).toEqual(["Conta PF", "Conta PJ"]);

    const pj = await app.inject({ method: "GET", url: "/accounts?entity=pj", headers: u.h });
    expect(pj.json().map((a: { name: string }) => a.name)).toEqual(["Conta PJ"]);

    const pf = await app.inject({ method: "GET", url: "/accounts?entity=pf", headers: u.h });
    expect(pf.json().map((a: { name: string }) => a.name)).toEqual(["Conta PF"]);
  });

  it("GET /accounts?entity=xx retorna 400", async () => {
    const u = await newUser("acc6");
    const res = await app.inject({ method: "GET", url: "/accounts?entity=xx", headers: u.h });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /accounts/:id altera entidade, instituição e número da conta", async () => {
    const u = await newUser("acc7");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta" } });
    const id = created.json().id;

    const res = await app.inject({
      method: "PATCH", url: `/accounts/${id}`, headers: u.h,
      payload: { entity: "pj", institution: "c6", externalId: "99887" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id, entity: "pj", institution: "c6", externalId: "99887", name: "Conta" });

    const cleared = await app.inject({ method: "PATCH", url: `/accounts/${id}`, headers: u.h, payload: { externalId: null } });
    expect(cleared.json().externalId).toBeNull();
  });

  it("PATCH com dados de cartão em conta corrente retorna 400", async () => {
    const u = await newUser("acc8");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name: "Conta" } });
    const res = await app.inject({ method: "PATCH", url: `/accounts/${created.json().id}`, headers: u.h, payload: { dueDay: 5 } });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH em cartão atualiza fechamento, vencimento e limite", async () => {
    const u = await newUser("acc9");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "credit_card", name: "Cartão" } });
    const res = await app.inject({
      method: "PATCH", url: `/accounts/${created.json().id}`, headers: u.h,
      payload: { closingDay: 3, dueDay: 10, creditLimitCents: 120000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ closingDay: 3, dueDay: 10, creditLimitCents: 120000 });
  });

  it("PATCH em conta de outro workspace retorna 404", async () => {
    const a = await newUser("acc10a");
    const b = await newUser("acc10b");
    const created = await app.inject({ method: "POST", url: "/accounts", headers: a.h, payload: { type: "checking", name: "Da A" } });
    const res = await app.inject({ method: "PATCH", url: `/accounts/${created.json().id}`, headers: b.h, payload: { entity: "pj" } });
    expect(res.statusCode).toBe(404);
  });

  it("filtro global: entrada inválida em outra rota validada por Zod também é 400", async () => {
    const u = await newUser("acc11");
    const res = await app.inject({ method: "POST", url: "/transactions", headers: u.h, payload: { type: "expense" } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts
```

Esperado: FAIL em quase todos (respostas sem `entity`; validações retornando 500; `PATCH /accounts/:id` 404 de rota).

- [x] **Step 3: Criar o filtro global e o parser de `?entity=`**

Criar `apps/api/src/common/zod-exception.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { ZodError } from "@app/shared";

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(error: ZodError, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const message = error.issues.map((i) => `${i.path.join(".") || "corpo"}: ${i.message}`);
    void reply.status(400).send({ statusCode: 400, error: "Bad Request", message });
  }
}
```

Criar `apps/api/src/common/entity-query.ts`:

```ts
import { BadRequestException } from "@nestjs/common";
import { ACCOUNT_ENTITIES, type AccountEntity } from "@app/shared";

/** Converte o parâmetro `?entity=` (ausente, vazio, pf ou pj) em `AccountEntity | undefined`. */
export function parseEntityQuery(value?: string): AccountEntity | undefined {
  if (value === undefined || value === "") return undefined;
  if ((ACCOUNT_ENTITIES as readonly string[]).includes(value)) return value as AccountEntity;
  throw new BadRequestException("entity deve ser pf ou pj");
}
```

Em `apps/api/src/app.module.ts`, acrescentar os imports no topo:

```ts
import { APP_FILTER } from "@nestjs/core";
import { ZodExceptionFilter } from "./common/zod-exception.filter";
```

e, dentro do decorator `@Module({ … })`, depois da lista `imports: [ … ],`, acrescentar:

```ts
  providers: [{ provide: APP_FILTER, useClass: ZodExceptionFilter }],
```

- [x] **Step 4: Reescrever o service e o controller de contas**

Substituir `apps/api/src/accounts/accounts.service.ts` por:

```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { cardFieldsPresent, type AccountEntity, type AccountInput, type AccountUpdateInput } from "@app/shared";
import { prisma } from "../database";

const ACCOUNT_SELECT = {
  id: true,
  type: true,
  name: true,
  openingBalanceCents: true,
  archived: true,
  entity: true,
  institution: true,
  externalId: true,
  closingDay: true,
  dueDay: true,
  creditLimitCents: true,
} as const;

@Injectable()
export class AccountsService {
  async create(workspaceId: string, dto: AccountInput) {
    return prisma.bankAccount.create({
      data: {
        workspaceId,
        type: dto.type,
        name: dto.name,
        openingBalanceCents: dto.openingBalanceCents ?? 0,
        entity: dto.entity,
        institution: dto.institution,
        externalId: dto.externalId ?? null,
        closingDay: dto.closingDay ?? null,
        dueDay: dto.dueDay ?? null,
        creditLimitCents: dto.creditLimitCents ?? null,
      },
      select: ACCOUNT_SELECT,
    });
  }

  async listActive(workspaceId: string, entity?: AccountEntity) {
    return prisma.bankAccount.findMany({
      where: { workspaceId, archived: false, ...(entity ? { entity } : {}) },
      select: ACCOUNT_SELECT,
      orderBy: { createdAt: "asc" },
    });
  }

  async update(workspaceId: string, id: string, dto: AccountUpdateInput) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId }, select: { type: true } });
    if (!existing) throw new NotFoundException();
    if (existing.type !== "credit_card" && cardFieldsPresent(dto)) {
      throw new BadRequestException("closingDay, dueDay e creditLimitCents só valem para cartão de crédito");
    }
    return prisma.bankAccount.update({ where: { id }, data: dto, select: ACCOUNT_SELECT });
  }

  async archive(workspaceId: string, id: string) {
    const existing = await prisma.bankAccount.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException();
    await prisma.bankAccount.update({ where: { id }, data: { archived: true } });
    return { ok: true };
  }
}
```

Substituir `apps/api/src/accounts/accounts.controller.ts` por:

```ts
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { accountSchema, accountUpdateSchema } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { parseEntityQuery } from "../common/entity-query";
import { AccountsService } from "./accounts.service";

@Controller("accounts")
@UseGuards(CurrentUserGuard)
export class AccountsController {
  constructor(private readonly service: AccountsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, accountSchema.parse(body));
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query("entity") entity?: string) {
    return this.service.listActive(user.workspaceId, parseEntityQuery(entity));
  }

  @Patch(":id")
  update(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string, @Body() body: unknown) {
    return this.service.update(user.workspaceId, id, accountUpdateSchema.parse(body));
  }

  @Patch(":id/archive")
  archive(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.service.archive(user.workspaceId, id);
  }
}
```

- [x] **Step 5: Rodar os testes da fase e a suíte de finanças**

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts test/e2e/finance.e2e.test.ts
```

Esperado: os 11 testes novos passam e os 8 de `finance.e2e.test.ts` continuam passando (o teste T3 de contagem de categorias só muda na Task 3).

- [x] **Step 6: Typecheck**

```bash
pnpm --filter @app/api typecheck
```

Esperado: sem erros. (Se reclamar de `data: dto` por causa de `undefined` em campos obrigatórios do Prisma, o tipo de `AccountUpdateInput` já os torna opcionais; se ainda falhar, expandir explicitamente: `data: { name: dto.name, entity: dto.entity, institution: dto.institution, externalId: dto.externalId, closingDay: dto.closingDay, dueDay: dto.dueDay, creditLimitCents: dto.creditLimitCents }`.)

- [x] **Step 7: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
feat(api): contas com entidade, instituição e dados de cartão; PATCH /accounts/:id; ZodError vira 400

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Categorias por entidade e categorias PJ de fábrica

**Files:**
- Modify: `apps/api/src/categories/seed-categories.ts`
- Modify: `apps/api/src/auth/index.ts`
- Modify: `apps/api/src/categories/categories.service.ts`
- Modify: `apps/api/src/categories/categories.controller.ts`
- Modify: `apps/api/test/e2e/finance.e2e.test.ts` (teste T3)
- Modify: `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts` (novo `describe`)

**Interfaces:**
- Consumes (Task 1): `categorySchema` com `entity`; (Task 2): `parseEntityQuery`, helper `newUser`.
- Produces:
  - `defaultCategoryRows(): Array<{ type: "income" | "expense"; name: string; entity: "both" | "pj"; isSystem: true }>` exportada de `seed-categories.ts` (27 itens: 20 `both` + 7 `pj`); `seedDefaultCategories(workspaceId)` continua existindo.
  - `GET /categories?type=&entity=pf|pj` devolve as categorias com `entity` igual ao pedido **ou** `both`. Toda resposta de categoria inclui `entity`.
  - `POST /categories` aceita `entity` (padrão `both`); `PATCH /categories/:id` permite alterar `entity`.

- [x] **Step 1: Atualizar o teste T3 existente e escrever os novos (devem falhar)**

Em `apps/api/test/e2e/finance.e2e.test.ts`, substituir o teste `"T3: novo usuário recebe 5 receitas e 15 despesas como categorias"` inteiro por:

```ts
  it("T3: novo usuário recebe categorias pessoais (both) e categorias PJ (pj)", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `t3_${ts}@test.com`, password: "senha123!", name: "T3" } });
    const h = { authorization: `Bearer ${u!.token}` };

    const list = await app.inject({ method: "GET", url: "/categories", headers: h });
    const cats = list.json() as Array<{ type: string; isSystem: boolean; entity: string }>;
    const count = (entity: string, type: string) => cats.filter((c) => c.entity === entity && c.type === type).length;
    expect(count("both", "income")).toBe(5);
    expect(count("both", "expense")).toBe(15);
    expect(count("pj", "income")).toBe(1);
    expect(count("pj", "expense")).toBe(6);
    expect(cats.every((c) => c.isSystem)).toBe(true);
  });
```

Acrescentar ao final de `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`:

```ts
describe("Fase 10 — categorias por entidade", () => {
  it("novo usuário recebe as 7 categorias PJ de fábrica", async () => {
    const u = await newUser("cat1");
    const list = await app.inject({ method: "GET", url: "/categories", headers: u.h });
    const pj = (list.json() as Array<{ name: string; type: string; entity: string }>).filter((c) => c.entity === "pj");
    expect(pj.map((c) => c.name).sort()).toEqual([
      "Fornecedores", "Folha e terceiros", "Impostos e tributos", "Pró-labore",
      "Receita de serviços", "Serviços contratados", "Tarifas bancárias",
    ].sort());
    expect(pj.find((c) => c.name === "Receita de serviços")?.type).toBe("income");
  });

  it("GET /categories?entity= devolve a entidade pedida mais as compartilhadas (both)", async () => {
    const u = await newUser("cat2");
    await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Só PF", entity: "pf" } });

    const names = async (q: string) =>
      ((await app.inject({ method: "GET", url: `/categories${q}`, headers: u.h })).json() as Array<{ name: string }>).map((c) => c.name);

    const pf = await names("?entity=pf");
    expect(pf).toContain("Só PF");
    expect(pf).toContain("Supermercado");
    expect(pf).not.toContain("Pró-labore");

    const pj = await names("?entity=pj");
    expect(pj).toContain("Pró-labore");
    expect(pj).toContain("Supermercado");
    expect(pj).not.toContain("Só PF");

    expect((await names("")).length).toBe(pf.length + pj.length - (await names("?entity=pf")).filter((n) => pj.includes(n)).length);
  });

  it("combina ?type= e ?entity=", async () => {
    const u = await newUser("cat3");
    const res = await app.inject({ method: "GET", url: "/categories?type=income&entity=pj", headers: u.h });
    const cats = res.json() as Array<{ type: string; entity: string }>;
    expect(cats.length).toBeGreaterThan(0);
    expect(cats.every((c) => c.type === "income" && (c.entity === "pj" || c.entity === "both"))).toBe(true);
  });

  it("?entity=xx retorna 400", async () => {
    const u = await newUser("cat4");
    const res = await app.inject({ method: "GET", url: "/categories?entity=xx", headers: u.h });
    expect(res.statusCode).toBe(400);
  });

  it("POST cria com entity (padrão both) e PATCH altera a entity", async () => {
    const u = await newUser("cat5");
    const padrao = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Padrão" } });
    expect(padrao.statusCode).toBe(201);
    expect(padrao.json().entity).toBe("both");

    const pj = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Custo PJ", entity: "pj" } });
    expect(pj.json().entity).toBe("pj");

    const patched = await app.inject({ method: "PATCH", url: `/categories/${pj.json().id}`, headers: u.h, payload: { entity: "both" } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().entity).toBe("both");
  });

  it("PATCH sem entity não reseta a entity existente", async () => {
    const u = await newUser("cat6");
    const created = await app.inject({ method: "POST", url: "/categories", headers: u.h, payload: { type: "expense", name: "Custo PJ", entity: "pj" } });
    const patched = await app.inject({ method: "PATCH", url: `/categories/${created.json().id}`, headers: u.h, payload: { name: "Custo PJ renomeado" } });
    expect(patched.json()).toMatchObject({ name: "Custo PJ renomeado", entity: "pj" });
  });

  it("workspace criado por POST /workspaces também recebe as categorias PJ", async () => {
    const u = await newUser("cat7");
    const ws = await app.inject({ method: "POST", url: "/workspaces", headers: u.h, payload: { type: "business", name: "Empresa" } });
    expect(ws.statusCode).toBe(201);
    const list = await app.inject({
      method: "GET", url: "/categories?entity=pj", headers: { ...u.h, "x-workspace-id": ws.json().id },
    });
    expect((list.json() as Array<{ name: string }>).map((c) => c.name)).toContain("Pró-labore");
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts test/e2e/finance.e2e.test.ts
```

Esperado: FAIL nos testes de categorias e no T3 (respostas sem `entity`, sem categorias PJ).

- [x] **Step 3: Fonte única das categorias de fábrica**

Substituir `apps/api/src/categories/seed-categories.ts` por:

```ts
import { prisma } from "../database";

type SeedCategory = { type: "income" | "expense"; name: string; entity: "both" | "pj" };

const PESSOAIS: SeedCategory[] = [
  { type: "income", name: "Salário", entity: "both" },
  { type: "income", name: "Freelance", entity: "both" },
  { type: "income", name: "Investimentos", entity: "both" },
  { type: "income", name: "Reembolso", entity: "both" },
  { type: "income", name: "Outras receitas", entity: "both" },
  { type: "expense", name: "Moradia", entity: "both" },
  { type: "expense", name: "Contas e utilidades", entity: "both" },
  { type: "expense", name: "Supermercado", entity: "both" },
  { type: "expense", name: "Restaurantes e delivery", entity: "both" },
  { type: "expense", name: "Transporte", entity: "both" },
  { type: "expense", name: "Combustível", entity: "both" },
  { type: "expense", name: "Saúde", entity: "both" },
  { type: "expense", name: "Farmácia", entity: "both" },
  { type: "expense", name: "Educação", entity: "both" },
  { type: "expense", name: "Lazer", entity: "both" },
  { type: "expense", name: "Compras", entity: "both" },
  { type: "expense", name: "Assinaturas", entity: "both" },
  { type: "expense", name: "Impostos e taxas", entity: "both" },
  { type: "expense", name: "Pets", entity: "both" },
  { type: "expense", name: "Outras despesas", entity: "both" },
];

const PJ: SeedCategory[] = [
  { type: "income", name: "Receita de serviços", entity: "pj" },
  { type: "expense", name: "Pró-labore", entity: "pj" },
  { type: "expense", name: "Impostos e tributos", entity: "pj" },
  { type: "expense", name: "Fornecedores", entity: "pj" },
  { type: "expense", name: "Serviços contratados", entity: "pj" },
  { type: "expense", name: "Tarifas bancárias", entity: "pj" },
  { type: "expense", name: "Folha e terceiros", entity: "pj" },
];

/** Linhas (sem workspaceId) das categorias de fábrica; usadas pelo onboarding e por `seedDefaultCategories`. */
export function defaultCategoryRows() {
  return [...PESSOAIS, ...PJ].map((c) => ({ ...c, isSystem: true as const }));
}

export async function seedDefaultCategories(workspaceId: string) {
  await prisma.category.createMany({
    data: defaultCategoryRows().map((c) => ({ ...c, workspaceId })),
    skipDuplicates: true,
  });
}
```

Em `apps/api/src/auth/index.ts`: acrescentar o import junto dos demais

```ts
import { defaultCategoryRows } from "../categories/seed-categories";
```

e substituir todo o bloco `categories: { createMany: { data: [ … ] } },` (as 20 linhas `{ type: …, name: …, isSystem: true }`) por:

```ts
              categories: { createMany: { data: defaultCategoryRows() } },
```

- [x] **Step 4: Service e controller de categorias**

Substituir `apps/api/src/categories/categories.service.ts` por:

```ts
import { Injectable, NotFoundException } from "@nestjs/common";
import type { AccountEntity, CategoryInput } from "@app/shared";
import { prisma } from "../database";

const CATEGORY_SELECT = {
  id: true, type: true, name: true, parentId: true, icon: true, color: true, isSystem: true, entity: true,
} as const;

@Injectable()
export class CategoriesService {
  async list(workspaceId: string, type?: string, entity?: AccountEntity) {
    return prisma.category.findMany({
      where: {
        workspaceId,
        ...(type ? { type: type as "income" | "expense" } : {}),
        ...(entity ? { entity: { in: [entity, "both"] as Array<AccountEntity | "both"> } } : {}),
      },
      select: CATEGORY_SELECT,
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
  }

  async create(workspaceId: string, dto: CategoryInput) {
    return prisma.category.create({
      data: {
        workspaceId, type: dto.type, name: dto.name, parentId: dto.parentId ?? null,
        icon: dto.icon ?? null, color: dto.color ?? null, entity: dto.entity,
      },
      select: CATEGORY_SELECT,
    });
  }

  async update(workspaceId: string, id: string, dto: Partial<CategoryInput>) {
    const existing = await prisma.category.findFirst({ where: { id, workspaceId } });
    if (!existing) throw new NotFoundException();
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

  async remove(workspaceId: string, id: string) {
    const existing = await prisma.category.findFirst({ where: { id, workspaceId, isSystem: false } });
    if (!existing) throw new NotFoundException();
    await prisma.category.delete({ where: { id } });
    return { ok: true };
  }
}
```

Em `apps/api/src/categories/categories.controller.ts`, acrescentar o import

```ts
import { parseEntityQuery } from "../common/entity-query";
```

e substituir o método `list`:

```ts
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("type") type?: string,
    @Query("entity") entity?: string,
  ) {
    return this.service.list(user.workspaceId, type, parseEntityQuery(entity));
  }
```

- [x] **Step 5: Rodar os testes**

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts test/e2e/finance.e2e.test.ts
```

Esperado: todos passam.

- [x] **Step 6: Suíte completa da API e typecheck**

```bash
pnpm --filter @app/api test
pnpm --filter @app/api typecheck
```

Esperado: todos os arquivos passam (nenhum outro teste depende da contagem de categorias; se algum falhar por causa das 7 categorias novas, ajustar a asserção do teste, não a fábrica) e typecheck verde.

- [x] **Step 7: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
feat(api): categorias com escopo PF/PJ, categorias PJ de fábrica e fonte única do seed

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Filtro por entidade na listagem de transações

**Files:**
- Modify: `apps/api/src/transactions/transactions.service.ts` (método `list`)
- Modify: `apps/api/src/transactions/transactions.controller.ts` (rota `GET /transactions`)
- Modify: `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts` (novo `describe`)

**Interfaces:**
- Consumes (Task 2): `parseEntityQuery`, `newUser`.
- Produces: `GET /transactions?entity=pf|pj` devolve as transações em que **alguma** das contas envolvidas (`account`, `sourceAccount` ou `destAccount`) tem a entidade pedida. Uma transferência PF→PJ aparece nos dois filtros. Combina com `accountId`, `categoryId`, `from`, `to` e `q` por AND.

- [x] **Step 1: Escrever o teste e2e (deve falhar)**

Acrescentar ao final de `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`:

```ts
describe("Fase 10 — transações filtradas por entidade", () => {
  async function seedPfPj(tag: string) {
    const u = await newUser(tag);
    const mk = async (name: string, entity: "pf" | "pj") =>
      (await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name, entity } })).json().id as string;
    const pf = await mk("Conta PF", "pf");
    const pj = await mk("Conta PJ", "pj");
    const tx = async (payload: Record<string, unknown>) =>
      app.inject({ method: "POST", url: "/transactions", headers: u.h, payload: { date: "2026-06-10", amountCents: 1000, ...payload } });
    await tx({ type: "expense", accountId: pf, description: "mercado" });
    await tx({ type: "income", accountId: pj, description: "nota fiscal" });
    await tx({ type: "transfer", sourceAccountId: pf, destAccountId: pj, description: "aporte" });
    return { u, pf, pj };
  }

  const descs = (res: { json: () => unknown }) =>
    (res.json() as Array<{ description: string }>).map((t) => t.description).sort();

  it("sem entity devolve tudo; entity=pf e entity=pj filtram pela conta envolvida", async () => {
    const { u } = await seedPfPj("tx1");

    expect(descs(await app.inject({ method: "GET", url: "/transactions", headers: u.h }))).toEqual(["aporte", "mercado", "nota fiscal"]);
    expect(descs(await app.inject({ method: "GET", url: "/transactions?entity=pf", headers: u.h }))).toEqual(["aporte", "mercado"]);
    expect(descs(await app.inject({ method: "GET", url: "/transactions?entity=pj", headers: u.h }))).toEqual(["aporte", "nota fiscal"]);
  });

  it("entity combina com accountId por AND", async () => {
    const { u, pf } = await seedPfPj("tx2");
    const res = await app.inject({ method: "GET", url: `/transactions?entity=pj&accountId=${pf}`, headers: u.h });
    expect(descs(res)).toEqual(["aporte"]);
  });

  it("entity combina com busca textual", async () => {
    const { u } = await seedPfPj("tx3");
    const res = await app.inject({ method: "GET", url: "/transactions?entity=pf&q=mercado", headers: u.h });
    expect(descs(res)).toEqual(["mercado"]);
  });

  it("entity inválida retorna 400", async () => {
    const u = await newUser("tx4");
    const res = await app.inject({ method: "GET", url: "/transactions?entity=xx", headers: u.h });
    expect(res.statusCode).toBe(400);
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts -t "transações filtradas"
```

Esperado: FAIL (o filtro `entity` é ignorado: `entity=pf` devolve as 3 transações; `entity=xx` retorna 200).

- [x] **Step 3: Implementar o filtro**

Em `apps/api/src/transactions/transactions.controller.ts`, acrescentar o import

```ts
import { parseEntityQuery } from "../common/entity-query";
```

e substituir o método `list`:

```ts
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("accountId") accountId?: string,
    @Query("categoryId") categoryId?: string,
    @Query("q") q?: string,
    @Query("entity") entity?: string,
  ) {
    return this.service.list(user.workspaceId, { from, to, accountId, categoryId, q, entity: parseEntityQuery(entity) });
  }
```

Em `apps/api/src/transactions/transactions.service.ts`, acrescentar aos imports do topo

```ts
import type { AccountEntity } from "@app/shared";
import type { Prisma } from "../../generated/prisma/client";
```

e substituir o método `list` inteiro por:

```ts
  async list(
    workspaceId: string,
    filters: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string; entity?: AccountEntity },
  ) {
    const { from, to, accountId, categoryId, q, entity } = filters;

    const and: Prisma.TransactionWhereInput[] = [];
    if (accountId) {
      and.push({ OR: [{ accountId }, { sourceAccountId: accountId }, { destAccountId: accountId }] });
    }
    if (entity) {
      and.push({ OR: [{ account: { entity } }, { sourceAccount: { entity } }, { destAccount: { entity } }] });
    }

    return prisma.transaction.findMany({
      where: {
        workspaceId,
        ...(from || to
          ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(q ? { description: { contains: q, mode: "insensitive" as const } } : {}),
        ...(and.length ? { AND: and } : {}),
      },
      select: {
        id: true, type: true, amountCents: true, date: true,
        accountId: true, sourceAccountId: true, destAccountId: true,
        categoryId: true, description: true, counterparty: true, source: true, createdAt: true,
      },
      orderBy: { date: "desc" },
    });
  }
```

- [x] **Step 4: Rodar os testes e o typecheck**

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts test/e2e/finance.e2e.test.ts
pnpm --filter @app/api typecheck
```

Esperado: todos passam (os 4 testes novos e os de finanças, incluindo o filtro por `accountId` já existente) e typecheck verde.

- [x] **Step 5: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
feat(api): GET /transactions aceita entity (PF/PJ) pelas contas envolvidas

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Configurações do workspace (`WorkspaceSettings`)

**Files:**
- Create: `apps/api/src/workspaces/workspace-settings.service.ts`
- Create: `apps/api/src/workspaces/workspace-settings.controller.ts`
- Modify: `apps/api/src/workspaces/workspaces.module.ts`
- Modify: `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts` (novo `describe`)

**Interfaces:**
- Consumes (Task 1): `workspaceSettingsUpdateSchema`, `DEFAULT_WORKSPACE_SETTINGS`; (Task 2): `newUser`.
- Produces:
  - `GET /workspaces/current/settings` → `{ aiConfidenceThreshold: number; aiBatchSize: number; transferMatchWindowDays: number; ownerNames: string[] }` do workspace ativo (header `x-workspace-id` ou o primeiro). Cria a linha com os padrões na primeira leitura (upsert), então workspaces antigos e novos funcionam sem passo extra.
  - `PATCH /workspaces/current/settings` com qualquer subconjunto desses campos; só `owner` e `admin` (senão 403); valores inválidos → 400.
  - `WorkspaceSettingsService.get(workspaceId)` e `.update(workspaceId, role, dto)`; a fase 12 consome `get`.

- [x] **Step 1: Escrever o teste e2e (deve falhar)**

Acrescentar ao final de `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`:

```ts
describe("Fase 10 — configurações do workspace", () => {
  it("GET devolve os padrões da spec na primeira leitura", async () => {
    const u = await newUser("set1");
    const res = await app.inject({ method: "GET", url: "/workspaces/current/settings", headers: u.h });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: [] });
  });

  it("PATCH parcial persiste e preserva os demais campos", async () => {
    const u = await newUser("set2");
    const patched = await app.inject({
      method: "PATCH", url: "/workspaces/current/settings", headers: u.h,
      payload: { aiConfidenceThreshold: 0.9, ownerNames: ["  Stael Edson  ", "Plural Med Ltda"] },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toEqual({
      aiConfidenceThreshold: 0.9, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson", "Plural Med Ltda"],
    });

    const again = await app.inject({ method: "GET", url: "/workspaces/current/settings", headers: u.h });
    expect(again.json().aiConfidenceThreshold).toBe(0.9);
    expect(again.json().ownerNames).toEqual(["Stael Edson", "Plural Med Ltda"]);
  });

  it("PATCH inválido retorna 400", async () => {
    const u = await newUser("set3");
    const res = await app.inject({ method: "PATCH", url: "/workspaces/current/settings", headers: u.h, payload: { aiConfidenceThreshold: 1.5 } });
    expect(res.statusCode).toBe(400);
  });

  it("viewer lê mas não altera (403)", async () => {
    const owner = await newUser("set4o");
    const viewer = await newUser("set4v");
    const add = await app.inject({
      method: "POST", url: `/workspaces/${owner.workspaceId}/members`, headers: owner.h,
      payload: { userId: viewer.userId, role: "viewer" },
    });
    expect(add.statusCode).toBe(201);

    const vh = { ...viewer.h, "x-workspace-id": owner.workspaceId };
    const read = await app.inject({ method: "GET", url: "/workspaces/current/settings", headers: vh });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({ method: "PATCH", url: "/workspaces/current/settings", headers: vh, payload: { aiBatchSize: 10 } });
    expect(write.statusCode).toBe(403);
  });

  it("cada workspace tem as próprias configurações", async () => {
    const a = await newUser("set5a");
    const b = await newUser("set5b");
    await app.inject({ method: "PATCH", url: "/workspaces/current/settings", headers: a.h, payload: { aiBatchSize: 77 } });
    const res = await app.inject({ method: "GET", url: "/workspaces/current/settings", headers: b.h });
    expect(res.json().aiBatchSize).toBe(40);
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts -t "configurações do workspace"
```

Esperado: FAIL (404 nas rotas).

- [x] **Step 3: Implementar service, controller e módulo**

Criar `apps/api/src/workspaces/workspace-settings.service.ts`:

```ts
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { WorkspaceSettingsInput } from "@app/shared";
import { prisma } from "../database";

const SETTINGS_SELECT = {
  aiConfidenceThreshold: true,
  aiBatchSize: true,
  transferMatchWindowDays: true,
  ownerNames: true,
} as const;

const CAN_EDIT = ["owner", "admin"];

@Injectable()
export class WorkspaceSettingsService {
  /** Lê as configurações; a linha é criada com os padrões do banco na primeira leitura. */
  async get(workspaceId: string) {
    return prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: { workspaceId },
      update: {},
      select: SETTINGS_SELECT,
    });
  }

  async update(workspaceId: string, role: string, dto: Partial<WorkspaceSettingsInput>) {
    if (!CAN_EDIT.includes(role)) throw new ForbiddenException("apenas owner ou admin alteram as configurações");
    return prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...dto },
      update: dto,
      select: SETTINGS_SELECT,
    });
  }
}
```

Criar `apps/api/src/workspaces/workspace-settings.controller.ts`:

```ts
import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { workspaceSettingsUpdateSchema } from "@app/shared";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { WorkspaceSettingsService } from "./workspace-settings.service";

@Controller("workspaces/current/settings")
@UseGuards(CurrentUserGuard)
export class WorkspaceSettingsController {
  constructor(private readonly service: WorkspaceSettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.service.get(user.workspaceId);
  }

  @Patch()
  update(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.update(user.workspaceId, user.role, workspaceSettingsUpdateSchema.parse(body));
  }
}
```

Substituir `apps/api/src/workspaces/workspaces.module.ts` por:

```ts
import { Module } from "@nestjs/common";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";
import { WorkspaceSettingsController } from "./workspace-settings.controller";
import { WorkspaceSettingsService } from "./workspace-settings.service";

@Module({
  controllers: [WorkspacesController, WorkspaceSettingsController],
  providers: [WorkspacesService, WorkspaceSettingsService],
  exports: [WorkspaceSettingsService],
})
export class WorkspacesModule {}
```

- [x] **Step 4: Rodar a suíte completa da API e o typecheck**

```bash
pnpm --filter @app/api test
pnpm --filter @app/api typecheck
```

Esperado: todos os arquivos passam (74 testes anteriores, menos o T3 reescrito que continua 1, mais os novos da fase) e typecheck verde.

- [x] **Step 5: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
feat(api): GET/PATCH /workspaces/current/settings (WorkspaceSettings)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Front — helpers, tipos, chamadas e store

**Files:**
- Create: `apps/web/src/lib/entity.ts`
- Create: `apps/web/src/lib/account-form.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/stores/finance.ts`
- Create: `apps/web/src/lib/__tests__/entity.test.ts`
- Create: `apps/web/src/lib/__tests__/account-form.test.ts`
- Create: `apps/web/src/lib/__tests__/api-entity.test.ts`

**Interfaces:**
- Consumes: contrato da API das Tasks 2–4.
- Produces:
  - `lib/entity.ts`: `type AccountEntity = "pf" | "pj"`, `type EntityFilter = AccountEntity | "all"`, `type Institution`, `type CategoryEntity = AccountEntity | "both"`, `ENTITY_LABEL`, `ENTITY_SHORT`, `INSTITUTION_LABEL`, `ACCOUNT_TYPE_LABEL`, `accountsForEntity(accounts, filter)`, `categoriesForEntity(categories, entity)`.
  - `lib/account-form.ts`: `interface AccountFormState`, `emptyAccountForm()`, `formFromAccount(acc)`, `buildCreateAccountPayload(f): NewAccount`, `buildUpdateAccountPayload(f): UpdateAccount`.
  - `lib/api.ts`: `BankAccount` ganha `entity`, `institution`, `externalId`, `closingDay`, `dueDay`, `creditLimitCents`; `Category` ganha `entity`; exports `NewAccount`, `UpdateAccount`; `api.accounts.list(entity?)`, `api.accounts.update(id, body)`, `api.categories.list(type?, entity?)`, `api.transactions.list({ …, entity? })`.
  - store: `updateAccount(id: string, body: UpdateAccount): Promise<BankAccount>`.

- [x] **Step 1: Escrever os testes dos helpers (devem falhar)**

Criar `apps/web/src/lib/__tests__/entity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { accountsForEntity, categoriesForEntity, ENTITY_SHORT, ENTITY_LABEL, INSTITUTION_LABEL } from "../entity";

const accounts = [
  { id: "1", entity: "pf" as const },
  { id: "2", entity: "pj" as const },
  { id: "3", entity: "pf" as const },
];

const categories = [
  { id: "a", entity: "both" as const },
  { id: "b", entity: "pj" as const },
  { id: "c", entity: "pf" as const },
];

describe("accountsForEntity", () => {
  it("all devolve todas", () => {
    expect(accountsForEntity(accounts, "all").map((a) => a.id)).toEqual(["1", "2", "3"]);
  });
  it("pf e pj filtram", () => {
    expect(accountsForEntity(accounts, "pf").map((a) => a.id)).toEqual(["1", "3"]);
    expect(accountsForEntity(accounts, "pj").map((a) => a.id)).toEqual(["2"]);
  });
});

describe("categoriesForEntity", () => {
  it("sem entidade devolve todas", () => {
    expect(categoriesForEntity(categories, undefined).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("pj devolve pj e both; pf devolve pf e both", () => {
    expect(categoriesForEntity(categories, "pj").map((c) => c.id)).toEqual(["a", "b"]);
    expect(categoriesForEntity(categories, "pf").map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("rótulos", () => {
  it("cobrem todas as entidades e instituições", () => {
    expect(ENTITY_SHORT).toEqual({ pf: "PF", pj: "PJ" });
    expect(ENTITY_LABEL.pj).toBe("Pessoa Jurídica");
    expect(Object.keys(INSTITUTION_LABEL).sort()).toEqual(["bb", "c6", "inter", "mercado_pago", "other"]);
  });
});
```

Criar `apps/web/src/lib/__tests__/account-form.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  emptyAccountForm,
  formFromAccount,
  buildCreateAccountPayload,
  buildUpdateAccountPayload,
} from "../account-form";
import type { BankAccount } from "../api";

describe("buildCreateAccountPayload", () => {
  it("conta corrente: converte reais em centavos e omite dados de cartão", () => {
    const f = { ...emptyAccountForm(), name: "  Inter PF  ", entity: "pf" as const, institution: "inter" as const, openingBalanceReais: 10.5, closingDay: 10, dueDay: 17, creditLimitReais: 500 };
    expect(buildCreateAccountPayload(f)).toEqual({
      type: "checking", name: "Inter PF", openingBalanceCents: 1050,
      entity: "pf", institution: "inter", externalId: null,
    });
  });

  it("cartão: inclui fechamento, vencimento e limite em centavos", () => {
    const f = { ...emptyAccountForm(), type: "credit_card" as const, name: "C6 Empresa", entity: "pj" as const, institution: "c6" as const, externalId: " 1234 ", closingDay: 10, dueDay: 17, creditLimitReais: 5000.5 };
    expect(buildCreateAccountPayload(f)).toMatchObject({
      type: "credit_card", entity: "pj", institution: "c6", externalId: "1234",
      closingDay: 10, dueDay: 17, creditLimitCents: 500050,
    });
  });

  it("cartão: campos numéricos vazios (string vazia do input) viram null", () => {
    const f = { ...emptyAccountForm(), type: "credit_card" as const, name: "Cartão", closingDay: "" as unknown as number, dueDay: null, creditLimitReais: "" as unknown as number };
    expect(buildCreateAccountPayload(f)).toMatchObject({ closingDay: null, dueDay: null, creditLimitCents: null });
  });
});

describe("buildUpdateAccountPayload", () => {
  it("não envia tipo nem saldo inicial", () => {
    const f = { ...emptyAccountForm(), name: "Conta", entity: "pj" as const, institution: "bb" as const };
    const p = buildUpdateAccountPayload(f);
    expect(p).toEqual({ name: "Conta", entity: "pj", institution: "bb", externalId: null });
    expect(p).not.toHaveProperty("type");
    expect(p).not.toHaveProperty("openingBalanceCents");
  });

  it("cartão envia os três campos de cartão", () => {
    const f = { ...emptyAccountForm(), type: "credit_card" as const, name: "C", closingDay: 5, dueDay: 12, creditLimitReais: 100 };
    expect(buildUpdateAccountPayload(f)).toMatchObject({ closingDay: 5, dueDay: 12, creditLimitCents: 10000 });
  });
});

describe("formFromAccount", () => {
  it("converte centavos em reais e trata nulos", () => {
    const acc: BankAccount = {
      id: "1", type: "credit_card", name: "Cartão", openingBalanceCents: 0, archived: false,
      entity: "pj", institution: "c6", externalId: null, closingDay: 10, dueDay: 17, creditLimitCents: 500050,
    };
    expect(formFromAccount(acc)).toMatchObject({
      type: "credit_card", name: "Cartão", entity: "pj", institution: "c6", externalId: "",
      closingDay: 10, dueDay: 17, creditLimitReais: 5000.5,
    });
  });
});
```

Criar `apps/web/src/lib/__tests__/api-entity.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http", () => ({ http: vi.fn(async () => []) }));

import { http } from "../http";
import { api } from "../api";

const lastCall = () => {
  const calls = vi.mocked(http).mock.calls;
  return (calls[calls.length - 1] ?? []).slice(0, 3);
};

beforeEach(() => vi.mocked(http).mockClear());

describe("api — entidade PF/PJ", () => {
  it("accounts.list envia ?entity= só quando informado", async () => {
    await api.accounts.list();
    expect(lastCall()).toEqual(["GET", "/accounts", undefined]);
    await api.accounts.list("pj");
    expect(lastCall()).toEqual(["GET", "/accounts?entity=pj", undefined]);
  });

  it("accounts.update usa PATCH /accounts/:id", async () => {
    await api.accounts.update("a1", { entity: "pj" });
    expect(lastCall()).toEqual(["PATCH", "/accounts/a1", { entity: "pj" }]);
  });

  it("categories.list combina type e entity", async () => {
    await api.categories.list();
    expect(lastCall()[1]).toBe("/categories");
    await api.categories.list("expense", "pj");
    expect(lastCall()[1]).toBe("/categories?type=expense&entity=pj");
    await api.categories.list(undefined, "pf");
    expect(lastCall()[1]).toBe("/categories?entity=pf");
  });

  it("transactions.list inclui entity na query string", async () => {
    await api.transactions.list({ entity: "pf", accountId: "a1" });
    expect(lastCall()[1]).toBe("/transactions?accountId=a1&entity=pf");
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/web test
```

Esperado: FAIL nos três arquivos novos (módulos `../entity` e `../account-form` inexistentes; `api.accounts.update` indefinido).

- [x] **Step 3: Criar `lib/entity.ts`**

```ts
import type { AccountType } from "./api";

export type AccountEntity = "pf" | "pj";
export type EntityFilter = AccountEntity | "all";
export type Institution = "bb" | "inter" | "mercado_pago" | "c6" | "other";
export type CategoryEntity = AccountEntity | "both";

export const ENTITY_LABEL: Record<AccountEntity, string> = {
  pf: "Pessoa Física",
  pj: "Pessoa Jurídica",
};

export const ENTITY_SHORT: Record<AccountEntity, string> = { pf: "PF", pj: "PJ" };

export const INSTITUTION_LABEL: Record<Institution, string> = {
  bb: "Banco do Brasil",
  inter: "Inter",
  mercado_pago: "Mercado Pago",
  c6: "C6 Bank",
  other: "Outra",
};

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
  investment: "Investimento",
};

export function accountsForEntity<T extends { entity: AccountEntity }>(accounts: T[], filter: EntityFilter): T[] {
  return filter === "all" ? accounts : accounts.filter((a) => a.entity === filter);
}

/** Categorias `both` valem para qualquer entidade; sem entidade, nada é filtrado. */
export function categoriesForEntity<T extends { entity: CategoryEntity }>(
  categories: T[],
  entity: AccountEntity | null | undefined,
): T[] {
  return entity ? categories.filter((c) => c.entity === "both" || c.entity === entity) : categories;
}
```

- [x] **Step 4: Criar `lib/account-form.ts`**

```ts
import type { AccountType, BankAccount, NewAccount, UpdateAccount } from "./api";
import type { AccountEntity, Institution } from "./entity";

export interface AccountFormState {
  name: string;
  type: AccountType;
  entity: AccountEntity;
  institution: Institution;
  externalId: string;
  openingBalanceReais: number;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitReais: number | null;
}

export function emptyAccountForm(): AccountFormState {
  return {
    name: "",
    type: "checking",
    entity: "pf",
    institution: "other",
    externalId: "",
    openingBalanceReais: 0,
    closingDay: null,
    dueDay: null,
    creditLimitReais: null,
  };
}

export function formFromAccount(acc: BankAccount): AccountFormState {
  return {
    name: acc.name,
    type: acc.type,
    entity: acc.entity,
    institution: acc.institution,
    externalId: acc.externalId ?? "",
    openingBalanceReais: acc.openingBalanceCents / 100,
    closingDay: acc.closingDay,
    dueDay: acc.dueDay,
    creditLimitReais: acc.creditLimitCents == null ? null : acc.creditLimitCents / 100,
  };
}

/** `v-model.number` deixa string vazia quando o campo é apagado; isso vira null. */
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && !Number.isNaN(v) ? v : null;
}

function reaisToCents(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n * 100);
}

function cardFields(f: AccountFormState) {
  return {
    closingDay: numOrNull(f.closingDay),
    dueDay: numOrNull(f.dueDay),
    creditLimitCents: reaisToCents(f.creditLimitReais),
  };
}

export function buildCreateAccountPayload(f: AccountFormState): NewAccount {
  return {
    type: f.type,
    name: f.name.trim(),
    openingBalanceCents: Math.round(f.openingBalanceReais * 100),
    entity: f.entity,
    institution: f.institution,
    externalId: f.externalId.trim() || null,
    ...(f.type === "credit_card" ? cardFields(f) : {}),
  };
}

export function buildUpdateAccountPayload(f: AccountFormState): UpdateAccount {
  return {
    name: f.name.trim(),
    entity: f.entity,
    institution: f.institution,
    externalId: f.externalId.trim() || null,
    ...(f.type === "credit_card" ? cardFields(f) : {}),
  };
}
```

- [x] **Step 5: Atualizar `lib/api.ts`**

No topo, depois do import de `http`, acrescentar:

```ts
import type { AccountEntity, CategoryEntity, Institution } from "./entity";
```

Substituir a interface `BankAccount` por:

```ts
export interface BankAccount {
  id: string;
  type: AccountType;
  name: string;
  openingBalanceCents: number;
  archived: boolean;
  entity: AccountEntity;
  institution: Institution;
  externalId: string | null;
  closingDay: number | null;
  dueDay: number | null;
  creditLimitCents: number | null;
}

export interface NewAccount {
  type: AccountType;
  name: string;
  openingBalanceCents?: number;
  entity?: AccountEntity;
  institution?: Institution;
  externalId?: string | null;
  closingDay?: number | null;
  dueDay?: number | null;
  creditLimitCents?: number | null;
}

export type UpdateAccount = Partial<Omit<NewAccount, "type" | "openingBalanceCents">>;
```

Na interface `Category`, acrescentar depois de `isSystem: boolean;`:

```ts
  entity: CategoryEntity;
```

No objeto `api`, substituir os blocos `accounts`, `categories` e o método `list` de `transactions`:

```ts
  accounts: {
    list: (entity?: AccountEntity) => req<BankAccount[]>("GET", `/accounts${entity ? `?entity=${entity}` : ""}`),
    create: (body: NewAccount) => req<BankAccount>("POST", "/accounts", body),
    update: (id: string, body: UpdateAccount) => req<BankAccount>("PATCH", `/accounts/${id}`, body),
    archive: (id: string) => req<{ ok: boolean }>("PATCH", `/accounts/${id}/archive`),
  },
  categories: {
    list: (type?: CategoryType, entity?: AccountEntity) => {
      const qs = new URLSearchParams();
      if (type) qs.set("type", type);
      if (entity) qs.set("entity", entity);
      const s = qs.toString();
      return req<Category[]>("GET", `/categories${s ? `?${s}` : ""}`);
    },
  },
  transactions: {
    list: (params?: { from?: string; to?: string; accountId?: string; categoryId?: string; q?: string; entity?: AccountEntity }) => {
      const qs = new URLSearchParams();
      if (params?.from) qs.set("from", params.from);
      if (params?.to) qs.set("to", params.to);
      if (params?.accountId) qs.set("accountId", params.accountId);
      if (params?.categoryId) qs.set("categoryId", params.categoryId);
      if (params?.q) qs.set("q", params.q);
      if (params?.entity) qs.set("entity", params.entity);
      const s = qs.toString();
      return req<Transaction[]>("GET", `/transactions${s ? `?${s}` : ""}`);
    },
```

(o método `create` de `transactions` logo abaixo permanece como está; o objeto `balances` e `dashboard` também.)

- [x] **Step 6: Atualizar a store**

Em `apps/web/src/stores/finance.ts`, substituir o import de `lib/api`:

```ts
import { api, type BankAccount, type Category, type Transaction, type Balances, type Dashboard, type NewAccount, type UpdateAccount } from "../lib/api";
```

substituir `createAccount` e acrescentar `updateAccount` logo depois:

```ts
  async function createAccount(data: NewAccount) {
    const acc = await api.accounts.create(data);
    accounts.value.push(acc);
    return acc;
  }

  async function updateAccount(id: string, data: UpdateAccount) {
    const acc = await api.accounts.update(id, data);
    accounts.value = accounts.value.map((a) => (a.id === id ? acc : a));
    return acc;
  }
```

e acrescentar `updateAccount` ao objeto retornado:

```ts
    loadAccounts, createAccount, updateAccount, archiveAccount,
```

- [x] **Step 7: Rodar testes e typecheck do web**

```bash
pnpm --filter @app/web test
pnpm --filter @app/web typecheck
```

Esperado: testes passam (18 anteriores + os novos). O typecheck pode apontar `AccountsView.vue` (usa `createAccount` com objeto já compatível, então deve passar; `Category`/`BankAccount` agora têm campos obrigatórios novos — se algum mock/fixture no web construir esses tipos, acrescentar os campos).

- [x] **Step 8: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
feat(web): tipos, chamadas e helpers de entidade PF/PJ (conta, categoria, transação)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Front — telas de Contas e Transações com PF/PJ

**Files:**
- Create: `apps/web/src/components/AccountFields.vue`
- Modify (reescrever): `apps/web/src/views/AccountsView.vue`
- Modify: `apps/web/src/views/TransactionsView.vue`

**Interfaces:**
- Consumes (Task 6): `AccountFormState`, `emptyAccountForm`, `formFromAccount`, `buildCreateAccountPayload`, `buildUpdateAccountPayload`, `ENTITY_LABEL`, `ENTITY_SHORT`, `INSTITUTION_LABEL`, `ACCOUNT_TYPE_LABEL`, `accountsForEntity`, `categoriesForEntity`, `store.updateAccount`, `api.transactions.list({ entity })`.
- Produces: telas funcionais (sem novos contratos para outras tasks). Componente `AccountFields` com `v-model` de `AccountFormState` e props `showOpeningBalance?: boolean`, `lockType?: boolean`.

Não há teste de componente nesta task (o projeto não usa `@vue/test-utils`); a lógica testável está nos helpers da Task 6. A verificação é por typecheck e pelo teste manual no navegador da Task 8.

- [x] **Step 1: Criar o componente de campos de conta**

Criar `apps/web/src/components/AccountFields.vue`:

```vue
<script setup lang="ts">
import { ACCOUNT_TYPE_LABEL, ENTITY_LABEL, INSTITUTION_LABEL } from "../lib/entity";
import type { AccountFormState } from "../lib/account-form";

defineProps<{ showOpeningBalance?: boolean; lockType?: boolean }>();
const form = defineModel<AccountFormState>({ required: true });
</script>

<template>
  <div class="account-fields">
    <input v-model="form.name" placeholder="Nome" />
    <select v-model="form.type" :disabled="lockType" aria-label="Tipo de conta">
      <option v-for="(label, value) in ACCOUNT_TYPE_LABEL" :key="value" :value="value">{{ label }}</option>
    </select>
    <select v-model="form.entity" aria-label="Entidade">
      <option v-for="(label, value) in ENTITY_LABEL" :key="value" :value="value">{{ label }}</option>
    </select>
    <select v-model="form.institution" aria-label="Instituição">
      <option v-for="(label, value) in INSTITUTION_LABEL" :key="value" :value="value">{{ label }}</option>
    </select>
    <input v-model="form.externalId" placeholder="Nº da conta ou final do cartão (opcional)" />
    <input
      v-if="showOpeningBalance"
      v-model.number="form.openingBalanceReais"
      type="number"
      step="0.01"
      placeholder="Saldo inicial (R$)"
    />
    <template v-if="form.type === 'credit_card'">
      <input v-model.number="form.closingDay" type="number" min="1" max="31" placeholder="Dia de fechamento (1–31)" />
      <input v-model.number="form.dueDay" type="number" min="1" max="31" placeholder="Dia de vencimento (1–31)" />
      <input v-model.number="form.creditLimitReais" type="number" min="0" step="0.01" placeholder="Limite (R$)" />
    </template>
  </div>
</template>

<style scoped>
.account-fields { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
input, select { padding: calc(var(--space) * 1.5); border: 1px solid #333; border-radius: calc(var(--radius) / 2); background: var(--color-bg); color: var(--color-text); font-size: 1rem; }
</style>
```

- [x] **Step 2: Reescrever `AccountsView.vue`**

Substituir o conteúdo inteiro de `apps/web/src/views/AccountsView.vue` por:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useFinanceStore } from "../stores/finance";
import type { BankAccount } from "../lib/api";
import {
  ACCOUNT_TYPE_LABEL, ENTITY_SHORT, INSTITUTION_LABEL, accountsForEntity,
  type EntityFilter,
} from "../lib/entity";
import {
  emptyAccountForm, formFromAccount, buildCreateAccountPayload, buildUpdateAccountPayload,
} from "../lib/account-form";
import AccountFields from "../components/AccountFields.vue";

const store = useFinanceStore();
const filtro = ref<EntityFilter>("all");
const novo = ref(emptyAccountForm());
const editId = ref<string | null>(null);
const edicao = ref(emptyAccountForm());
const erro = ref("");

const filtros: { value: EntityFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pf", label: "PF" },
  { value: "pj", label: "PJ" },
];

const visiveis = computed(() => accountsForEntity(store.accounts, filtro.value));

function saldoDe(acc: BankAccount): number {
  return store.balances?.accounts.find((b) => b.accountId === acc.id)?.balanceCents ?? acc.openingBalanceCents;
}
const saldoVisivel = computed(() => visiveis.value.reduce((s, a) => s + saldoDe(a), 0));

onMounted(async () => {
  await Promise.all([store.loadAccounts(), store.loadBalances()]);
});

async function criar() {
  erro.value = "";
  if (!novo.value.name.trim()) { erro.value = "Nome obrigatório"; return; }
  try {
    await store.createAccount(buildCreateAccountPayload(novo.value));
    await store.loadBalances();
    novo.value = emptyAccountForm();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

function iniciarEdicao(acc: BankAccount) {
  erro.value = "";
  editId.value = acc.id;
  edicao.value = formFromAccount(acc);
}

function cancelarEdicao() {
  editId.value = null;
}

async function salvarEdicao() {
  if (!editId.value) return;
  erro.value = "";
  if (!edicao.value.name.trim()) { erro.value = "Nome obrigatório"; return; }
  try {
    await store.updateAccount(editId.value, buildUpdateAccountPayload(edicao.value));
    editId.value = null;
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

async function arquivar(id: string) {
  await store.archiveAccount(id);
  await store.loadBalances();
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function detalhe(acc: BankAccount): string {
  const partes = [ENTITY_SHORT[acc.entity], INSTITUTION_LABEL[acc.institution], ACCOUNT_TYPE_LABEL[acc.type]];
  if (acc.externalId) partes.push(`final ${acc.externalId}`);
  return partes.join(" · ");
}

function detalheCartao(acc: BankAccount): string | null {
  if (acc.type !== "credit_card") return null;
  const partes: string[] = [];
  if (acc.closingDay) partes.push(`fecha dia ${acc.closingDay}`);
  if (acc.dueDay) partes.push(`vence dia ${acc.dueDay}`);
  if (acc.creditLimitCents != null) partes.push(`limite ${formatBRL(acc.creditLimitCents)}`);
  return partes.length ? partes.join(" · ") : null;
}
</script>

<template>
  <section class="accounts">
    <h2>Contas</h2>

    <div class="entity-filter" role="group" aria-label="Filtrar por entidade">
      <button
        v-for="f in filtros"
        :key="f.value"
        type="button"
        :class="{ active: filtro === f.value }"
        @click="filtro = f.value"
      >{{ f.label }}</button>
    </div>

    <div class="consolidated" v-if="store.balances">
      Saldo {{ filtro === 'all' ? 'consolidado' : filtro.toUpperCase() }}: <strong>{{ formatBRL(saldoVisivel) }}</strong>
    </div>

    <ul class="account-list">
      <li v-for="acc in visiveis" :key="acc.id" class="account-item">
        <template v-if="editId === acc.id">
          <form class="edit-form" @submit.prevent="salvarEdicao">
            <AccountFields v-model="edicao" lock-type />
            <div class="edit-actions">
              <button type="submit">Salvar</button>
              <button type="button" class="btn-secondary" @click="cancelarEdicao">Cancelar</button>
            </div>
          </form>
        </template>
        <template v-else>
          <div class="account-info">
            <span class="account-name">{{ acc.name }}</span>
            <span class="account-type">{{ detalhe(acc) }}</span>
            <span v-if="detalheCartao(acc)" class="account-type">{{ detalheCartao(acc) }}</span>
          </div>
          <div class="account-actions">
            <span class="balance">{{ formatBRL(saldoDe(acc)) }}</span>
            <button type="button" class="btn-secondary" @click="iniciarEdicao(acc)">Editar</button>
            <button type="button" class="btn-danger" @click="arquivar(acc.id)">Arquivar</button>
          </div>
        </template>
      </li>
      <li v-if="visiveis.length === 0" class="empty">Nenhuma conta ativa.</li>
    </ul>

    <form class="create-form" @submit.prevent="criar">
      <h3>Nova conta</h3>
      <AccountFields v-model="novo" show-opening-balance />
      <button type="submit">Criar</button>
    </form>
    <p v-if="erro" role="alert">{{ erro }}</p>
  </section>
</template>

<style scoped>
.accounts { padding: calc(var(--space) * 3); max-width: 640px; margin: 0 auto; }
h2, h3 { margin-bottom: calc(var(--space) * 2); }
.entity-filter { display: flex; gap: var(--space); margin-bottom: calc(var(--space) * 2); }
.entity-filter button { background: var(--color-surface); color: var(--color-text); padding: var(--space) calc(var(--space) * 2); }
.entity-filter button.active { background: var(--color-primary); color: #fff; }
.consolidated { margin-bottom: calc(var(--space) * 3); font-size: 1.1rem; }
.account-list { list-style: none; display: flex; flex-direction: column; gap: var(--space); margin-bottom: calc(var(--space) * 4); }
.account-item { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--space) * 2); background: var(--color-surface); border-radius: var(--radius); gap: calc(var(--space) * 2); }
.account-info { display: flex; flex-direction: column; gap: 4px; }
.account-name { font-weight: 600; }
.account-type { font-size: 0.8rem; opacity: 0.6; }
.account-actions { display: flex; align-items: center; gap: calc(var(--space) * 2); flex-wrap: wrap; justify-content: flex-end; }
.balance { font-weight: 600; }
.empty { opacity: 0.5; font-style: italic; padding: var(--space); }
.create-form, .edit-form { display: flex; flex-direction: column; gap: calc(var(--space) * 2); width: 100%; }
.create-form { background: var(--color-surface); padding: calc(var(--space) * 3); border-radius: var(--radius); }
.edit-actions { display: flex; gap: var(--space); }
button { padding: calc(var(--space) * 1.5); border: none; border-radius: calc(var(--radius) / 2); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 1rem; }
.btn-secondary { background: #333; padding: calc(var(--space) * 0.75) calc(var(--space) * 1.5); font-size: 0.85rem; }
.btn-danger { background: #c0392b; padding: calc(var(--space) * 0.75) calc(var(--space) * 1.5); font-size: 0.85rem; }
p[role="alert"] { color: #e74c3c; font-size: 0.9rem; margin-top: calc(var(--space) * 2); }
</style>
```

- [x] **Step 3: Atualizar `TransactionsView.vue` — script**

Em `apps/web/src/views/TransactionsView.vue`:

1. Substituir as duas primeiras linhas de import

```ts
import { ref, onMounted, computed } from "vue";
import { useFinanceStore } from "../stores/finance";
import type { TransactionType } from "../lib/api";
```

por:

```ts
import { ref, onMounted, computed, watch } from "vue";
import { useFinanceStore } from "../stores/finance";
import type { Transaction, TransactionType } from "../lib/api";
import { ENTITY_SHORT, accountsForEntity, categoriesForEntity, type EntityFilter } from "../lib/entity";
```

2. Logo depois de `const filterQ = ref("");`, acrescentar:

```ts
const filterEntity = ref<EntityFilter>("all");
```

3. Substituir a linha `const currentCategories = computed(...)` (a última das três linhas `const incomeCategories` / `expenseCategories` / `currentCategories`) por:

```ts
const formAccountEntity = computed(() => store.accounts.find((a) => a.id === txAccountId.value)?.entity);
const currentCategories = computed(() =>
  categoriesForEntity(txType.value === "income" ? incomeCategories.value : expenseCategories.value, formAccountEntity.value),
);
const filterAccounts = computed(() => accountsForEntity(store.accounts, filterEntity.value));

// trocar a conta ou o tipo pode invalidar a categoria já escolhida
watch(currentCategories, (list) => {
  if (txCategoryId.value && !list.some((c) => c.id === txCategoryId.value)) txCategoryId.value = "";
});

function entityOf(tx: Transaction) {
  return store.accounts.find((a) => a.id === (tx.accountId ?? tx.sourceAccountId))?.entity;
}

async function onEntityChange() {
  if (filterAccountId.value && !filterAccounts.value.some((a) => a.id === filterAccountId.value)) {
    filterAccountId.value = "";
  }
  await filtrar();
}
```

4. Dentro de `filtrar()`, acrescentar ao objeto passado a `store.loadTransactions`:

```ts
    entity: filterEntity.value === "all" ? undefined : filterEntity.value,
```

(depois da linha `q: filterQ.value || undefined,`).

- [x] **Step 4: Atualizar `TransactionsView.vue` — template**

1. Substituir o bloco de filtros (da linha `<div class="filters">` até o `<select v-model="filterAccountId">…</select>` inclusive) por:

```html
    <div class="filters">
      <input v-model="filterFrom" type="date" placeholder="De" />
      <input v-model="filterTo" type="date" placeholder="Até" />
      <select v-model="filterEntity" aria-label="Entidade" @change="onEntityChange">
        <option value="all">PF e PJ</option>
        <option value="pf">Pessoa Física</option>
        <option value="pj">Pessoa Jurídica</option>
      </select>
      <select v-model="filterAccountId">
        <option value="">Todas as contas</option>
        <option v-for="a in filterAccounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
      </select>
```

2. As três opções restantes `<option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>` (campos Conta, Origem e Destino do formulário de lançamento) passam a exibir a entidade. Fazer a troca nas três ocorrências:

```html
<option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
```

3. No item da lista, acrescentar o selo de entidade logo depois de `<span class="tx-type">…</span>`:

```html
          <span v-if="entityOf(tx)" class="tx-entity">{{ ENTITY_SHORT[entityOf(tx)!] }}</span>
```

4. No `<style scoped>`, acrescentar:

```css
.tx-entity { font-size: 0.7rem; font-weight: 700; padding: 1px 6px; border-radius: 6px; background: var(--color-primary); color: #fff; }
```

- [x] **Step 5: Typecheck e testes do web**

```bash
pnpm --filter @app/web typecheck
pnpm --filter @app/web test
```

Esperado: typecheck verde (vue-tsc) e testes passando.

- [x] **Step 6: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
feat(web): contas com entidade, instituição e cartão (criar, editar, filtrar PF/PJ) e filtro PF/PJ em transações

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verificação de ponta a ponta, documentação e integração

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-30-fase-10-modelo-pf-pj.md` (marcar os passos)

**Interfaces:** nenhuma nova.

- [x] **Step 1: Typecheck e testes de todo o monorepo, sem cache**

```bash
docker compose up -d
pnpm exec prisma migrate deploy
pnpm turbo typecheck --force
pnpm turbo test --force
```

Esperado: exit 0 em ambos; nenhum teste ignorado ou falhando. Anotar as contagens finais por pacote (shared, api, worker, web) para o README.

- [x] **Step 2: Sem drift entre migrations, schema e banco**

```bash
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script | tail -2
```

Esperado: `-- This is an empty migration.`

- [x] **Step 3: Subir os apps e exercitar o fluxo PF/PJ pela API**

```bash
pnpm dev > "$TMPDIR/dev.log" 2>&1 &
sleep 30
grep -E "Worker started|ouvindo em" "$TMPDIR/dev.log"

B=http://localhost:3100
TS=$(date +%s)
R=$(curl -s -X POST $B/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:5173' \
  -d "{\"email\":\"f10_$TS@test.com\",\"password\":\"Smoke-$TS-pw!\",\"name\":\"F10\"}")
TOKEN=$(echo "$R" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
H=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json')

curl -s -X POST http://localhost:5173/api/accounts "${H[@]}" -d '{"type":"checking","name":"C6 PF","entity":"pf","institution":"c6"}'; echo
curl -s -X POST http://localhost:5173/api/accounts "${H[@]}" -d '{"type":"credit_card","name":"C6 PJ Cartão","entity":"pj","institution":"c6","closingDay":10,"dueDay":17,"creditLimitCents":500000}'; echo
echo "--- entity=pj:"; curl -s "http://localhost:5173/api/accounts?entity=pj" "${H[@]}"; echo
echo "--- categorias PJ:"; curl -s "http://localhost:5173/api/categories?entity=pj&type=expense" "${H[@]}" | python3 -c 'import sys,json;print(sorted(c["name"] for c in json.load(sys.stdin) if c["entity"]=="pj"))'
echo "--- settings:"; curl -s http://localhost:5173/api/workspaces/current/settings "${H[@]}"; echo
echo "--- 400 esperado:"; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:5173/api/accounts "${H[@]}" -d '{"type":"checking","name":"X","dueDay":5}'
```

Esperado: as duas contas voltam com `entity`/`institution`/dados de cartão; `entity=pj` lista só o cartão; as categorias PJ de despesa são `["Fornecedores","Folha e terceiros","Impostos e tributos","Pró-labore","Serviços contratados","Tarifas bancárias"]` (ordem alfabética do Python); settings traz `0.8/40/2/[]`; o último `curl` imprime `400`.

- [x] **Step 4: Verificar as telas no navegador**

Com o `pnpm dev` ainda rodando, abrir `http://localhost:5173` (navegador embutido ou o do usuário), entrar com a conta `f10_<ts>@test.com` criada no Step 3 (a senha é a do comando) e conferir:

1. Aba **Contas**: as duas contas aparecem com selo `PF · C6 Bank · Conta corrente` e `PJ · C6 Bank · Cartão de crédito` mais a linha `fecha dia 10 · vence dia 17 · limite R$ 5.000,00`. Os botões Todas/PF/PJ filtram a lista e o texto do saldo muda (`Saldo PJ: …`).
2. **Editar** a conta PF: trocar entidade para PJ e salvar → o item passa a exibir `PJ`; o tipo não pode ser alterado (select desabilitado).
3. **Nova conta** escolhendo `Cartão de crédito`: aparecem os três campos de cartão; trocando para `Conta corrente` eles somem. Criar uma conta sem nome mostra `Nome obrigatório`.
4. Aba **Transações**: lançar uma despesa na conta PJ → o seletor de categoria lista as categorias PJ (`Pró-labore`, …) e as compartilhadas, sem categorias só-PF; trocar para a conta PF remove as PJ e limpa a categoria escolhida se ela deixou de valer. O filtro `Pessoa Jurídica` mostra só lançamentos de contas PJ e restringe o filtro de contas; cada lançamento exibe o selo PF/PJ.

Registrar o resultado de cada item. Se algum falhar, corrigir na task correspondente antes de seguir.

- [x] **Step 5: Encerrar os servidores e limpar os dados de teste**

```bash
pkill -f 'turbo run dev'; pkill -f 'pnpm dev'; pkill -f 'tsx watch'; pkill -f 'nest start'; pkill -f vite
sleep 2
lsof -nP -iTCP:3100 -iTCP:5173 -sTCP:LISTEN | head -3
```

Esperado: sem saída (portas livres). Os dados do usuário `f10_*` ficam no banco de desenvolvimento e são apagados pela próxima execução dos testes e2e (`cleanDb`).

- [x] **Step 6: Atualizar o README**

Em `README.md`:

1. Na seção "Modelos Prisma", acrescentar `WorkspaceSettings` ao fim da lista e trocar `27 modelos` por `28 modelos` na árvore de pastas; trocar `9 migrations` por `10 migrations`.
2. Na seção "Testes", atualizar as contagens com os números anotados no Step 1 (shared, api, worker, web).
3. Na seção "Funcionalidades principais", acrescentar a linha:

```markdown
- **Contas PF e PJ no mesmo workspace** — cada conta tem entidade (PF/PJ), instituição e, nos cartões, fechamento, vencimento e limite; categorias têm escopo PF/PJ/ambos e há filtro PF/PJ em contas e transações
```

- [x] **Step 7: Marcar o plano e commitar a documentação**

```bash
sed -i '' 's/^- \[ \] \*\*Step/- [x] **Step/' docs/superpowers/plans/2026-09-30-fase-10-modelo-pf-pj.md
grep -c '^- \[ \]' docs/superpowers/plans/2026-09-30-fase-10-modelo-pf-pj.md
git add -A
git commit -m "$(cat <<'EOF'
docs: fecha a Fase 10 (plano marcado, README com modelos, contagens e funcionalidade PF/PJ)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
git status --short
```

Esperado: o `grep -c` imprime `0` e o `git status --short` fica vazio.

- [x] **Step 8: Integrar em `main` (pedir autorização antes do push)**

Enviar a branch e abrir PR exige autorização do usuário. Com ela:

```bash
git push -u origin fase-10-modelo-pf-pj
gh pr create --base main --head fase-10-modelo-pf-pj \
  --title "Fase 10 — modelo PF/PJ (contas, categorias, settings)" \
  --body "$(cat <<'EOF'
Entidade PF/PJ e instituição nas contas, dados de cartão, categorias com escopo e categorias PJ de fábrica, WorkspaceSettings, filtro PF/PJ em transações e telas de Contas/Transações. ZodError passa a responder 400.

Plano: docs/superpowers/plans/2026-09-30-fase-10-modelo-pf-pj.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr checks --watch
```

Esperado: todos os checks do CI em verde. Só então, com nova autorização do usuário, mesclar (`gh pr merge --merge`) e atualizar o `main` local (`git checkout main && git pull --ff-only origin main`).

---

## Self-Review

**Cobertura da spec (seções 3.1, 3.3, 3.5 e fase 2 da seção 10):**
- 3.1 `BankAccount` (`entity`, `institution`, `externalId`, `closingDay`, `dueDay`, `creditLimitCents`; validação Zod só-cartão; migration preenche `pf`) → Task 1 (schema, migration, Zod) e Task 2 (API).
- 3.3 `Category.entity` e seed PJ (as 7 categorias, `entity = pj`); "a tela lista categorias cujo `entity` seja `both` ou igual ao da conta" → Task 1 (coluna + migration de dados para workspaces existentes), Task 3 (seed, filtro da API) e Task 7 (filtro na tela de lançamento).
- 3.5 `WorkspaceSettings` (limiar, lote, janela, `ownerNames`) → Task 1 (tabela) e Task 5 (endpoints `GET/PATCH /workspaces/current/settings` da seção 5.2, antecipados porque o model nasce nesta fase).
- Fase 2 da seção 10: "tela de contas com entidade, instituição, dados de cartão; filtro PF/PJ em transações" → Tasks 6 e 7. Critério "contas PF e PJ cadastradas e filtráveis" → verificado na Task 8 (Steps 3 e 4).
- Itens fora de escopo respeitados: nenhum campo novo em `Transaction` ou `ImportBatch`, sem mudança de fingerprint ou de cálculo de saldo (constraints globais).
- Decisão derivada, fora do texto literal da spec: `entity` tem padrão `pf` na API para não quebrar chamadores existentes (a coluna no banco é obrigatória, como a spec pede). `PATCH /accounts/:id` foi adicionado porque as contas existentes viram `pf` na migration e precisam poder ser reclassificadas; a spec já cita esse endpoint para a fase 3. Não há UI de `WorkspaceSettings` (a spec a coloca na fase 12).
- Correção adjacente incluída por necessidade dos testes e do front: `ZodError` virava 500; o filtro global (Task 2) o transforma em 400 com as mensagens que o front já sabe exibir (`messageFrom` junta arrays de `message`).

**Varredura de placeholders:** todos os passos de código trazem o código; os trechos de edição do `TransactionsView.vue` e do `api.ts` indicam o ponto exato e o conteúdo final. O único passo sem código é a checagem visual do Step 4 da Task 8, que lista itens observáveis.

**Consistência de tipos e nomes:**
- `accountSchema`/`accountUpdateSchema`/`cardFieldsPresent`/`CARD_ONLY_FIELDS` (Task 1) são os mesmos usados em `accounts.service.ts`/`accounts.controller.ts` (Task 2).
- `parseEntityQuery` (criado na Task 2) é consumido com a mesma assinatura nas Tasks 3 e 4.
- `defaultCategoryRows()` (Task 3) é usado pelo `seedDefaultCategories` e pelo hook de onboarding; total de 27 linhas (20 `both` + 7 `pj`), o mesmo número que o teste T3 reescrito e a migration de dados (7 PJ) esperam.
- `newUser(tag)` (Task 2) devolve `{ userId, workspaceId, h }`; as Tasks 3, 4 e 5 usam exatamente esses três campos.
- No front, `AccountEntity`/`Institution`/`CategoryEntity` vivem em `lib/entity.ts`; `lib/api.ts` os importa como `import type` e `lib/entity.ts` importa `AccountType` de `api.ts` também só como tipo (sem ciclo em tempo de execução). `NewAccount`/`UpdateAccount` (Task 6, `api.ts`) são os mesmos tipos retornados por `buildCreateAccountPayload`/`buildUpdateAccountPayload` e aceitos por `store.createAccount`/`store.updateAccount`.
- `api.accounts.list(entity?)`, `api.categories.list(type?, entity?)` e `api.transactions.list({ entity })` batem com os testes de `api-entity.test.ts` e com o uso em `TransactionsView.vue` (`store.loadTransactions` repassa o objeto).
