# Fase 12 — Categorização e fila "Para categorizar" · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depois de importar, o sistema categoriza sozinho o que consegue (transferências entre contas próprias, regras, IA em lote com limiar de confiança) e leva o que sobrar para uma fila manual "Para categorizar", onde uma decisão vira regra e vale para lançamentos parecidos. Receita e despesa passam a ignorar transferências pareadas e lançamentos marcados como ignorados. A fase também fecha os seguimentos deixados pelas fases 10 e 11.

**Architecture:** Lógica pura e testável em `packages/shared` (normalização de descrição, similaridade por trigramas, detecção de pares de transferência, decisão sobre o resultado da IA, regra casada com id). O worker reescreve o job `categorize` em duas camadas: um núcleo puro `planCategorization` (recebe dados e um gateway de IA, devolve um plano) e um wrapper Prisma que carrega dados e aplica o plano em uma transação. A API ganha o módulo `review` (fila, categorizar grupo, aceitar sugestão, marcar/desfazer transferência, ignorar, recategorizar) e endurece importação (commit transacional, validação de categoria, categorySource nas gravações, limpeza de pares no desfazer). O front troca a tela "Revisar" por "Para categorizar" (pendentes agrupados + rascunhos + regras).

**Tech Stack:** pnpm 11 + Turborepo, NestJS 11 + Fastify 5, Prisma 7, BullMQ, Zod 3, Vue 3.5 + Pinia, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-contas-pf-pj-import-ia-dashboards-design.md`, seções 3.2 e 5 (fase 4 da seção 10), mais a regra de agregação da seção 3.2.

## Decisões e desvios da spec

| # | Spec | Este plano | Motivo |
|---|---|---|---|
| 1 | `installmentCurrent/installmentTotal` em `Transaction` (3.2) | **Adiado** | Só servem à fatura de cartão, adiada na fase 11 (sem arquivo de exemplo) |
| 2 | `GET /review/pending` devolve a lista de grupos | Devolve `{ total, groups }` | O cabeçalho da tela mostra o contador de pendentes sem outra chamada |
| 3 | Grupo = descrição normalizada | Chave = `tipo\|descrição normalizada`; o grupo carrega `type` e `entity` | Uma mesma descrição pode ser receita e despesa; a tela filtra as categorias por tipo e entidade |
| 4 | — | Endpoint extra `GET /review/transfer-candidates?transactionId=` | A tela precisa listar contrapartes possíveis para "marcar transferência" |
| 5 | IA: lote de 40 com categorias e exemplos "da entidade" | As chamadas são agrupadas por entidade da conta (pf, pj, sem conta) e cada chamada só recebe categorias e exemplos compatíveis | Cumpre a spec sem misturar categorias PJ em lançamentos PF |
| 6 | Job sem `batchId` processa `pending` e `none` | Igual; com `batchId` processa só `categorySource = none` do lote | Um lote recém-importado nunca foi categorizado |
| 7 | Regra de agregação em "todos os endpoints de dashboard e saldo" | Receita/despesa (dashboard, chat, orçamentos, insights, previsão de caixa) ignoram `transferPairId != null` e `ignored`; **saldo por conta não muda** | O saldo de uma conta precisa de todos os movimentos dela, inclusive os pareados |
| 8 | `GET /workspaces/current/settings` cria a linha na leitura | Passa a ler sem escrever e devolver os padrões | Seguimento da fase 10 (escrita a cada leitura) |
| 9 | O SQL dos insights do worker não tem teste automatizado com banco | Verificado na Task 8 com consulta real | Testes do worker não usam o banco compartilhado com os e2e da API (limpeza concorrente) |

## Global Constraints

- Branch de trabalho: `fase-12-categorizacao`, criada a partir de `main` (Task 1, Step 1). Merge em `main` só com testes verdes e com autorização do usuário para o push.
- Portas locais: Postgres `5433`, Redis `6380`, MinIO `9010`/`9011`, API `3100`, Web `5173`. Nunca 5432/6379/9000/3000. Infra no ar para os testes da API: `docker compose up -d`.
- Enums novos (valores da spec): `CategorySource { manual, rule, ai, import, none }`, `ReviewStatus { ok, pending }`.
- `Transaction` ganha `categorySource` (padrão `none`; transações existentes com categoria viram `manual`), `categoryConfidence Float?`, `reviewStatus` (padrão `ok`), `suggestedCategoryId String?` (FK `Category`, `SetNull`), `transferPairId String?` (indexado), `ignored Boolean @default(false)`. `CategoryRule` ganha `hitCount Int @default(0)`.
- Limiar e lote vêm de `WorkspaceSettings` (padrões 0,8 e 40; janela de transferência 2 dias; `ownerNames`). A categoria só vale para o lançamento se `category.type = tx.type` e `category.entity` é `both` ou igual à entidade da conta do lançamento.
- Receita e despesa excluem `transferPairId != null`, `ignored = true` e `type = transfer`. O saldo por conta (`BalancesService`, `get_balance` do chat) não muda.
- Falha da IA (rede, JSON inválido) nunca derruba o job: o lote inteiro fica `pending`.
- Nenhuma mensagem de erro de parser, descrição de lançamento ou texto de extrato vai para log.
- Migrations sem `prisma migrate dev`: SQL gerado por `prisma migrate diff --from-schema <schema antigo> --to-schema prisma/schema.prisma --script`, mais o passo de dados escrito à mão.
- Commits pequenos, em português, `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Nunca `pnpm --filter … test run`: use `pnpm --filter … test` ou `pnpm --filter @app/api exec vitest run <arquivo>`.
- Testes e2e da API compartilham o banco `financas` e rodam em série; `cleanDb()` apaga tudo. Testes do worker não usam o banco.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260930200000_fase12_categorizacao/migration.sql` | modificar/criar | colunas novas, enums, `hitCount`, dados |
| `packages/shared/src/categorization.ts` | criar | normalização, trigramas, `categoryFits`, decisão da IA, pares de transferência |
| `packages/shared/src/rules.ts` | modificar | `matchRule` (regra com id) |
| `packages/shared/src/parsers/ofx-statement.ts` | modificar | OFX malformado lança `StatementParseError` |
| `apps/worker/src/ai/categorize.core.ts` | criar | `planCategorization` (núcleo puro) |
| `apps/worker/src/ai/categorize.processor.ts` | reescrever | carrega dados, aplica o plano numa transação |
| `apps/worker/src/ai/openrouter.ts`, `draft-schema.ts` | modificar | `categorizeBatch` e JSON schema |
| `apps/worker/src/insights/reportable.ts` + `compute.processor.ts` + `cashflow.processor.ts` | criar/modificar | agregação sem transferências e ignorados |
| `apps/api/src/common/similar-transactions.ts` | criar | lançamentos parecidos ainda sem categoria |
| `apps/api/src/common/reportable.ts` | criar | filtro de receita/despesa (Prisma e SQL) |
| `apps/api/src/review/*` | criar | fila de revisão (controller, service, module) |
| `apps/api/src/transactions/*`, `category-rules/*`, `drafts`, `import/*`, `workspaces/workspace-settings.service.ts` | modificar | categorySource, `applyToSimilar`, `hitCount`, commit transacional, pares no desfazer, settings sem escrita |
| `apps/api/src/dashboard/*`, `chat/tools.ts`, `budgets/budgets.service.ts` | modificar | agregação sem transferências e ignorados |
| `apps/api/test/e2e/revisao.e2e.test.ts`, `integridade-importacao.e2e.test.ts`, `agregacao.e2e.test.ts` | criar | e2e da fase |
| `apps/web/src/lib/review-client.ts` (+ teste) | criar | cliente e helpers da fila |
| `apps/web/src/views/ReviewView.vue`, `components/RulesPanel.vue`, `App.vue` | reescrever/criar/modificar | "Para categorizar", regras, rótulo da aba |
| `README.md` | modificar | funcionalidade e contagens |

---

### Task 1: Modelo de dados (origem da categoria, revisão, pares, ignorados, `hitCount`)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260930200000_fase12_categorizacao/migration.sql`
- Modify: `apps/api/test/database/schema.test.ts`

**Interfaces:**
- Produces (Prisma): enums `CategorySource`, `ReviewStatus`; em `Transaction`: `categorySource`, `categoryConfidence`, `reviewStatus`, `suggestedCategoryId` (+ relação `suggestedCategory`), `transferPairId`, `ignored`; em `CategoryRule`: `hitCount`.

- [ ] **Step 1: Criar a branch**

```bash
git checkout main
git checkout -b fase-12-categorizacao
```

Esperado: `Switched to a new branch 'fase-12-categorizacao'`.

- [ ] **Step 2: Escrever o teste de schema (deve falhar)**

Em `apps/api/test/database/schema.test.ts`, acrescentar dentro do `describe("schema base", …)`, depois do último `it`:

```ts
  it("transactions e category_rules têm as colunas da fase 12", async () => {
    const cols = async (table: string) =>
      (await prisma.$queryRaw<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = ${table}`).map((r) => r.column_name);

    const tx = await cols("transactions");
    for (const c of ["categorySource", "categoryConfidence", "reviewStatus", "suggestedCategoryId", "transferPairId", "ignored"]) {
      expect(tx).toContain(c);
    }
    expect(await cols("category_rules")).toContain("hitCount");
  });

  it("enums CategorySource e ReviewStatus têm os valores da spec", async () => {
    const values = async (type: "CategorySource" | "ReviewStatus") =>
      (await prisma.$queryRawUnsafe<{ v: string }[]>(`select unnest(enum_range(null::"${type}"))::text as v`)).map((r) => r.v);
    expect(await values("CategorySource")).toEqual(["manual", "rule", "ai", "import", "none"]);
    expect(await values("ReviewStatus")).toEqual(["ok", "pending"]);
  });
```

- [ ] **Step 3: Rodar e confirmar a falha**

```bash
docker compose up -d
pnpm --filter @app/api exec vitest run test/database/schema.test.ts
```

Esperado: FAIL nos dois testes novos.

- [ ] **Step 4: Editar o `prisma/schema.prisma`**

1. Junto dos demais enums, acrescentar:

```prisma
enum CategorySource {
  manual
  rule
  ai
  import
  none
}

enum ReviewStatus {
  ok
  pending
}
```

2. No `model Transaction`, acrescentar depois da linha `importBatch ImportBatch? …` (antes de `costCenter`):

```prisma
  categorySource      CategorySource @default(none)
  categoryConfidence  Float?
  reviewStatus        ReviewStatus   @default(ok)
  suggestedCategoryId String?
  suggestedCategory   Category?      @relation("TransactionSuggestedCategory", fields: [suggestedCategoryId], references: [id], onDelete: SetNull)
  transferPairId      String?
  ignored             Boolean        @default(false)
```

e, junto dos `@@index` do model, acrescentar:

```prisma
  @@index([workspaceId, reviewStatus])
  @@index([transferPairId])
```

3. No `model Category`, acrescentar à lista de relações:

```prisma
  suggestedFor    Transaction[]  @relation("TransactionSuggestedCategory")
```

Se o `prisma validate` reclamar de relação ambígua entre `Transaction` e `Category`, nomear também a relação existente: em `Transaction.category` usar `@relation("TransactionCategory", fields: [categoryId], references: [id])` e em `Category.transactions` usar `@relation("TransactionCategory")`. Nomear relação não altera o SQL.

4. No `model CategoryRule`, acrescentar depois de `priority`:

```prisma
  hitCount    Int           @default(0)
```

```bash
pnpm exec prisma validate
```

Esperado: `The schema at prisma/schema.prisma is valid`.

- [ ] **Step 5: Gerar o SQL, acrescentar o passo de dados e aplicar**

```bash
git show HEAD:prisma/schema.prisma > "$TMPDIR/old.prisma"
mkdir -p prisma/migrations/20260930200000_fase12_categorizacao
pnpm exec prisma migrate diff --from-schema "$TMPDIR/old.prisma" --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/20260930200000_fase12_categorizacao/migration.sql
grep -cE "DROP" prisma/migrations/20260930200000_fase12_categorizacao/migration.sql
```

Esperado: a contagem de `DROP` é `0`; o arquivo tem dois `CREATE TYPE`, `ADD COLUMN` em `transactions` e `category_rules`, uma `FOREIGN KEY` para `suggestedCategoryId` e dois `CREATE INDEX`.

```bash
cat >> prisma/migrations/20260930200000_fase12_categorizacao/migration.sql <<'SQL'

-- Dados: transações que já tinham categoria passam a constar como categorizadas manualmente
UPDATE "transactions" SET "categorySource" = 'manual' WHERE "categoryId" IS NOT NULL;
SQL
```

Para provar o passo de dados, criar antes da aplicação uma transação com categoria e outra sem:

```bash
docker exec financas-postgres psql -U app -d financas <<'SQL'
insert into "user"(id, name, email, "emailVerified", "createdAt", "updatedAt")
  values ('u_pre12', 'Pré 12', 'pre12@test.com', false, now(), now()) on conflict do nothing;
insert into workspaces(id, type, name, "createdById", "updatedAt")
  values ('w_pre12', 'personal', 'Pré 12', 'u_pre12', now()) on conflict do nothing;
insert into categories(id, "workspaceId", type, name) values ('c_pre12', 'w_pre12', 'expense', 'Teste') on conflict do nothing;
insert into transactions(id, "workspaceId", type, "amountCents", date, "categoryId", "createdById")
  values ('t_pre12a', 'w_pre12', 'expense', 100, '2026-01-01', 'c_pre12', 'u_pre12'),
         ('t_pre12b', 'w_pre12', 'expense', 100, '2026-01-01', null, 'u_pre12') on conflict do nothing;
SQL
pnpm exec prisma migrate deploy
pnpm exec prisma generate
docker exec financas-postgres psql -U app -d financas -At -c "select id || ':' || \"categorySource\" || ':' || \"reviewStatus\" || ':' || ignored from transactions where id in ('t_pre12a','t_pre12b') order by id"
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script | grep -c "empty migration"
docker exec financas-postgres psql -U app -d financas -c "delete from \"user\" where id='u_pre12';"
```

Esperado: `t_pre12a:manual:ok:false`, `t_pre12b:none:ok:false`, depois `1` (sem drift). O `delete` remove os dados de teste por cascata.

- [ ] **Step 6: Rodar testes e typecheck**

```bash
pnpm --filter @app/api exec vitest run test/database/schema.test.ts
pnpm turbo typecheck
```

Esperado: 8 testes passam em `schema.test.ts` e typecheck verde nos 4 pacotes.

- [ ] **Step 7: Commit**

```bash
git add prisma apps/api/test/database/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): origem da categoria, status de revisão, pares de transferência, ignorados e hitCount das regras

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Lógica pura de categorização em `@app/shared`

**Files:**
- Create: `packages/shared/src/categorization.ts`
- Modify: `packages/shared/src/rules.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/categorization.test.ts`

**Interfaces:**
- Produces (todas exportadas por `@app/shared`):
  - `foldText(text: string): string` (minúsculas, sem acentos)
  - `normalizeDescriptionKey(text: string | null | undefined): string` (minúsculas, sem acentos, sem dígitos nem pontuação, espaços colapsados)
  - `trigramSimilarity(a: string, b: string): number` (Jaccard de trigramas, 0–1), `rankBySimilarity<T>(items: T[], getText: (item: T) => string, target: string, limit: number): T[]`, `chunk<T>(items: T[], size: number): T[][]`
  - `categoryFits(category: { type: "income" | "expense"; entity: CategoryEntity }, tx: { type: TransactionType }, accountEntity: AccountEntity | null | undefined): boolean`
  - `aiBatchResultSchema` (Zod: `{ results: [{ transactionId, categoryId: string | null, confidence: 0..1 }] }`), `type AiBatchResult`, `type AiDecision`, `decideAiResult(result: AiBatchResult | undefined, isValidCategory: (id: string) => boolean, threshold: number): AiDecision`
  - `type TransferCandidate { id; accountId; accountType: AccountType; type: "income" | "expense"; amountCents: number; date: string; text: string }`, `detectTransferPairs(candidates: TransferCandidate[], opts: { ownerNames: string[]; windowDays: number }): Array<[expenseId: string, incomeId: string]>`
  - `matchRule<T extends Rule>(text: string, rules: T[]): T | null` (`applyRules` passa a usá-la)

- [ ] **Step 1: Escrever os testes (devem falhar)**

Criar `packages/shared/src/__tests__/categorization.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  foldText, normalizeDescriptionKey, trigramSimilarity, rankBySimilarity, chunk, categoryFits,
  aiBatchResultSchema, decideAiResult, detectTransferPairs, matchRule, applyRules,
  type TransferCandidate,
} from "../index";

describe("normalização", () => {
  it("foldText tira acentos e caixa", () => {
    expect(foldText("José Açaí")).toBe("jose acai");
  });

  it("normalizeDescriptionKey agrupa variações da mesma descrição", () => {
    expect(normalizeDescriptionKey("iFood *Pedido 12345")).toBe("ifood pedido");
    expect(normalizeDescriptionKey("  IFOOD   pedido 998 ")).toBe("ifood pedido");
    expect(normalizeDescriptionKey(null)).toBe("");
    expect(normalizeDescriptionKey("PIX 001")).toBe("pix");
  });
});

describe("similaridade", () => {
  it("é 1 para textos iguais, 0 sem trigramas em comum e maior para o mais parecido", () => {
    expect(trigramSimilarity("supermercado extra", "Supermercado Extra 22")).toBe(1);
    expect(trigramSimilarity("abc", "xyz")).toBe(0);
    expect(trigramSimilarity("", "abc")).toBe(0);
    expect(trigramSimilarity("uber viagem", "uber trip")).toBeGreaterThan(trigramSimilarity("uber viagem", "padaria pao"));
  });

  it("rankBySimilarity ordena por semelhança, desempata pela ordem original e respeita o limite", () => {
    const items = ["padaria pao", "uber viagem sp", "uber viagem rj", "farmacia"];
    expect(rankBySimilarity(items, (s) => s, "uber viagem", 2)).toEqual(["uber viagem sp", "uber viagem rj"]);
    expect(rankBySimilarity(items, (s) => s, "qualquer", 10)).toHaveLength(4);
  });

  it("chunk divide em blocos e rejeita tamanho inválido", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });
});

describe("categoryFits", () => {
  const exp = { type: "expense" as const, entity: "both" as const };
  it("exige o mesmo tipo e recusa transferência", () => {
    expect(categoryFits(exp, { type: "expense" }, "pf")).toBe(true);
    expect(categoryFits(exp, { type: "income" }, "pf")).toBe(false);
    expect(categoryFits(exp, { type: "transfer" }, "pf")).toBe(false);
  });

  it("categoria PJ só serve a conta PJ; both serve às duas; sem conta só confere o tipo", () => {
    const pj = { type: "expense" as const, entity: "pj" as const };
    expect(categoryFits(pj, { type: "expense" }, "pj")).toBe(true);
    expect(categoryFits(pj, { type: "expense" }, "pf")).toBe(false);
    expect(categoryFits(pj, { type: "expense" }, null)).toBe(true);
    expect(categoryFits(exp, { type: "expense" }, "pj")).toBe(true);
  });
});

describe("decideAiResult", () => {
  const valid = (id: string) => id === "c1";
  it("aplica quando a categoria é válida e a confiança alcança o limiar", () => {
    expect(decideAiResult({ transactionId: "t", categoryId: "c1", confidence: 0.8 }, valid, 0.8)).toEqual({
      status: "ok", categoryId: "c1", confidence: 0.8,
    });
  });

  it("vira pendente com sugestão quando a confiança fica abaixo do limiar", () => {
    expect(decideAiResult({ transactionId: "t", categoryId: "c1", confidence: 0.79 }, valid, 0.8)).toEqual({
      status: "pending", suggestedCategoryId: "c1", confidence: 0.79,
    });
  });

  it("vira pendente sem sugestão quando a categoria é inválida, nula ou o resultado não veio", () => {
    const none = { status: "pending", suggestedCategoryId: null, confidence: null };
    expect(decideAiResult({ transactionId: "t", categoryId: "zzz", confidence: 0.99 }, valid, 0.8)).toEqual(none);
    expect(decideAiResult({ transactionId: "t", categoryId: null, confidence: 0.99 }, valid, 0.8)).toEqual(none);
    expect(decideAiResult(undefined, valid, 0.8)).toEqual(none);
  });

  it("o schema da resposta rejeita confiança fora de 0–1", () => {
    expect(aiBatchResultSchema.safeParse({ results: [{ transactionId: "t", categoryId: null, confidence: 1.5 }] }).success).toBe(false);
    expect(aiBatchResultSchema.safeParse({ results: [{ transactionId: "t", categoryId: "c", confidence: 0.5 }] }).success).toBe(true);
  });
});

describe("detectTransferPairs", () => {
  const tx = (over: Partial<TransferCandidate> & { id: string }): TransferCandidate => ({
    accountId: "a1", accountType: "checking", type: "expense", amountCents: 10000, date: "2026-06-10", text: "", ...over,
  });
  const OWNERS = ["Stael Edson", "SEAS Solutions Ltda"];

  it("pareia PJ→PF quando o texto cita o titular ou a empresa", () => {
    const pairs = detectTransferPairs([
      tx({ id: "saida", accountId: "pj", type: "expense", text: "Pix enviado para STAEL EDSON" }),
      tx({ id: "entrada", accountId: "pf", type: "income", text: "Pix recebido de SEAS Solutions Ltda" }),
    ], { ownerNames: OWNERS, windowDays: 2 });
    expect(pairs).toEqual([["saida", "entrada"]]);
  });

  it("ignora acentos e caixa ao procurar o nome", () => {
    const pairs = detectTransferPairs([
      tx({ id: "s", accountId: "pj", text: "Pix para JOSÉ DA SILVA" }),
      tx({ id: "e", accountId: "pf", type: "income", text: "Pix recebido" }),
    ], { ownerNames: ["José da Silva"], windowDays: 2 });
    expect(pairs).toEqual([["s", "e"]]);
  });

  it("pareia pagamento de fatura quando uma das contas é cartão de crédito", () => {
    const pairs = detectTransferPairs([
      tx({ id: "pgto", accountId: "cc", type: "expense", text: "PGTO FAT CARTAO C6" }),
      tx({ id: "fatura", accountId: "card", accountType: "credit_card", type: "income", text: "Pagamento recebido" }),
    ], { ownerNames: [], windowDays: 2 });
    expect(pairs).toEqual([["pgto", "fatura"]]);
  });

  it("não pareia sem sinal textual, fora da janela, na mesma conta, no mesmo sentido ou com valor diferente", () => {
    const base = { ownerNames: OWNERS, windowDays: 2 };
    const a = tx({ id: "a", accountId: "x", text: "Pix enviado para Stael Edson" }); // cita o titular: sinal presente
    const semSinal = [tx({ id: "a", accountId: "x", text: "Padaria" }), tx({ id: "b", accountId: "y", type: "income", text: "Fulano" })];
    expect(detectTransferPairs(semSinal, base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", date: "2026-06-13", text: "x" })], base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "x", type: "income", text: "x" })], base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "expense", text: "x" })], base)).toEqual([]);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", amountCents: 10001, text: "x" })], base)).toEqual([]);
  });

  it("a janela é inclusiva (2 dias pareia, 3 não)", () => {
    const a = tx({ id: "a", accountId: "x", text: "Stael Edson" });
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", date: "2026-06-12", text: "x" })], { ownerNames: OWNERS, windowDays: 2 })).toHaveLength(1);
    expect(detectTransferPairs([a, tx({ id: "b", accountId: "y", type: "income", date: "2026-06-13", text: "x" })], { ownerNames: OWNERS, windowDays: 2 })).toHaveLength(0);
  });

  it("cada lançamento entra em no máximo um par e vence a contraparte mais próxima", () => {
    const pairs = detectTransferPairs([
      tx({ id: "saida", accountId: "x", text: "Stael Edson", date: "2026-06-10" }),
      tx({ id: "longe", accountId: "y", type: "income", text: "x", date: "2026-06-12" }),
      tx({ id: "perto", accountId: "z", type: "income", text: "x", date: "2026-06-10" }),
    ], { ownerNames: OWNERS, windowDays: 2 });
    expect(pairs).toEqual([["saida", "perto"]]);
  });

  it("vários pares iguais (mesmo valor e dia) são pareados um a um sem reaproveitar lançamentos", () => {
    const pairs = detectTransferPairs([
      tx({ id: "s1", accountId: "x", text: "Stael Edson" }),
      tx({ id: "s2", accountId: "x", text: "Stael Edson" }),
      tx({ id: "e1", accountId: "y", type: "income", text: "x" }),
      tx({ id: "e2", accountId: "y", type: "income", text: "x" }),
    ], { ownerNames: OWNERS, windowDays: 2 });
    expect(pairs).toHaveLength(2);
    expect(new Set(pairs.flat()).size).toBe(4);
  });
});

describe("matchRule", () => {
  const rules = [
    { id: "r1", matchType: "contains" as const, pattern: "ifood", categoryId: "c-rest", priority: 100 },
    { id: "r2", matchType: "equals" as const, pattern: "ifood club", categoryId: "c-assin", priority: 150 },
  ];
  it("devolve a regra inteira (com id) e respeita a prioridade", () => {
    expect(matchRule("iFood Club", rules)?.id).toBe("r2");
    expect(matchRule("iFood Pedido", rules)?.id).toBe("r1");
    expect(matchRule("Uber", rules)).toBeNull();
  });

  it("applyRules continua devolvendo só o id da categoria", () => {
    expect(applyRules("iFood Club", rules)).toBe("c-assin");
    expect(applyRules("Uber", rules)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/shared test
```

Esperado: FAIL no novo arquivo (exports inexistentes). Os demais testes continuam passando.

- [ ] **Step 3: Implementar**

Em `packages/shared/src/rules.ts`, substituir a função `applyRules` por:

```ts
/** Regra de maior prioridade que casa com o texto (com todos os seus campos, inclusive id). */
export function matchRule<T extends Rule>(text: string, rules: T[]): T | null {
  const t = text.toLowerCase();
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const r of sorted) {
    const p = r.pattern.toLowerCase();
    const hit =
      r.matchType === "equals"
        ? t === p
        : r.matchType === "contains"
          ? t.includes(p)
          : new RegExp(r.pattern, "i").test(text);
    if (hit) return r;
  }
  return null;
}

export function applyRules(text: string, rules: Rule[]): string | null {
  return matchRule(text, rules)?.categoryId ?? null;
}
```

Criar `packages/shared/src/categorization.ts`:

```ts
import { z } from "zod";
import type { AccountEntity, AccountType, CategoryEntity, TransactionType } from "./enums";

export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Chave de agrupamento de descrições: minúsculas, sem acentos, sem dígitos nem pontuação, espaços colapsados. */
export function normalizeDescriptionKey(text: string | null | undefined): string {
  return foldText(text ?? "")
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(text: string): Set<string> {
  const padded = `  ${normalizeDescriptionKey(text)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Jaccard dos trigramas das duas descrições normalizadas (0–1). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (!normalizeDescriptionKey(a) || !normalizeDescriptionKey(b)) return 0;
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function rankBySimilarity<T>(items: T[], getText: (item: T) => string, target: string, limit: number): T[] {
  return items
    .map((item, index) => ({ item, index, score: trigramSimilarity(getText(item), target) }))
    .sort((x, y) => y.score - x.score || x.index - y.index)
    .slice(0, limit)
    .map((x) => x.item);
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("tamanho de lote inválido");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A categoria serve ao lançamento: mesmo tipo e entidade compatível (both vale para qualquer conta). */
export function categoryFits(
  category: { type: "income" | "expense"; entity: CategoryEntity },
  tx: { type: TransactionType },
  accountEntity: AccountEntity | null | undefined,
): boolean {
  if (tx.type === "transfer" || category.type !== tx.type) return false;
  return !accountEntity || category.entity === "both" || category.entity === accountEntity;
}

export const aiBatchResultSchema = z.object({
  results: z.array(
    z.object({
      transactionId: z.string(),
      categoryId: z.string().nullable(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type AiBatchResult = z.infer<typeof aiBatchResultSchema>["results"][number];

export type AiDecision =
  | { status: "ok"; categoryId: string; confidence: number }
  | { status: "pending"; suggestedCategoryId: string | null; confidence: number | null };

/** Aplica o limiar de confiança ao resultado da IA; categoria inválida ou ausente nunca vira sugestão. */
export function decideAiResult(
  result: AiBatchResult | undefined,
  isValidCategory: (id: string) => boolean,
  threshold: number,
): AiDecision {
  const categoryId = result?.categoryId ?? null;
  if (!result || categoryId === null || !isValidCategory(categoryId)) {
    return { status: "pending", suggestedCategoryId: null, confidence: null };
  }
  if (result.confidence >= threshold) return { status: "ok", categoryId, confidence: result.confidence };
  return { status: "pending", suggestedCategoryId: categoryId, confidence: result.confidence };
}

export interface TransferCandidate {
  id: string;
  accountId: string;
  accountType: AccountType;
  type: "income" | "expense";
  amountCents: number;
  date: string;
  text: string;
}

const CARD_PAYMENT = /pgto\.?\s*fat|pagamento\s+(de\s+)?fatura|pag\.?\s*fatura/;

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

function mentionsOwner(text: string, owners: string[]): boolean {
  const t = foldText(text);
  return owners.some((o) => {
    const name = foldText(o).trim();
    return name.length > 0 && t.includes(name);
  });
}

/**
 * Pares de transferência interna `[despesaId, receitaId]`: contas diferentes, mesmo valor, sentidos opostos,
 * datas a no máximo `windowDays` e um sinal textual (nome do titular/empresa ou pagamento de fatura com uma conta
 * de cartão). Cada lançamento entra em no máximo um par; vence a contraparte mais próxima no tempo.
 */
export function detectTransferPairs(
  candidates: TransferCandidate[],
  opts: { ownerNames: string[]; windowDays: number },
): Array<[string, string]> {
  const byAmount = new Map<number, TransferCandidate[]>();
  for (const c of candidates) {
    const group = byAmount.get(c.amountCents);
    if (group) group.push(c);
    else byAmount.set(c.amountCents, [c]);
  }

  const edges: Array<{ expense: TransferCandidate; income: TransferCandidate; days: number; order: number }> = [];
  let order = 0;
  for (const group of byAmount.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.accountId === b.accountId || a.type === b.type) continue;
        const days = Math.abs(dayNumber(a.date) - dayNumber(b.date));
        if (days > opts.windowDays) continue;
        const owner = mentionsOwner(a.text, opts.ownerNames) || mentionsOwner(b.text, opts.ownerNames);
        const card =
          (a.accountType === "credit_card" || b.accountType === "credit_card") &&
          (CARD_PAYMENT.test(foldText(a.text)) || CARD_PAYMENT.test(foldText(b.text)));
        if (!owner && !card) continue;
        const [expense, income] = a.type === "expense" ? [a, b] : [b, a];
        edges.push({ expense, income, days, order: order++ });
      }
    }
  }

  edges.sort((x, y) => x.days - y.days || x.order - y.order);
  const used = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const e of edges) {
    if (used.has(e.expense.id) || used.has(e.income.id)) continue;
    used.add(e.expense.id);
    used.add(e.income.id);
    pairs.push([e.expense.id, e.income.id]);
  }
  return pairs;
}
```

Em `packages/shared/src/index.ts`, acrescentar antes da linha `// Mesma instância de ZodError…`:

```ts
export * from "./categorization";
```

- [ ] **Step 4: Rodar testes e typecheck**

```bash
pnpm --filter @app/shared test
pnpm --filter @app/shared typecheck
```

Esperado: todos passam (103 anteriores + 19 novos) e typecheck verde. Se algum teste de `detectTransferPairs` falhar, corrigir o **código** (não o teste) quando a lógica divergir do docstring.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "$(cat <<'EOF'
feat(shared): lógica pura de categorização (normalização, trigramas, pares de transferência, decisão da IA, matchRule)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Worker — núcleo de planejamento, gateway de IA em lote e job `categorize`

**Files:**
- Modify: `apps/worker/src/ai/draft-schema.ts` (JSON schema)
- Modify: `apps/worker/src/ai/openrouter.ts` (`categorizeBatch`)
- Create: `apps/worker/src/ai/categorize.core.ts`
- Modify (reescrever): `apps/worker/src/ai/categorize.processor.ts`
- Create: `apps/worker/test/categorize-gateway.test.ts`, `apps/worker/test/categorize-core.test.ts`, `apps/worker/test/categorize-processor.test.ts`

**Interfaces:**
- Consumes (Task 2): `aiBatchResultSchema`, `AiBatchResult`, `categoryFits`, `chunk`, `decideAiResult`, `detectTransferPairs`, `matchRule`, `rankBySimilarity`, `TransferCandidate`, `DEFAULT_WORKSPACE_SETTINGS` de `@app/shared`; campos novos do Prisma (Task 1).
- Produces:
  - `OpenRouterGateway.categorizeBatch(input: { system: string; user: string }): Promise<{ results: AiBatchResult[]; costTokens: number | null }>` (lança em erro HTTP, JSON irrecuperável ou resposta fora do schema).
  - `categorize.core.ts`: tipos `CatTx`, `CatCategory`, `CatRule`, `CatExample`, `CatSettings`, `CategorizeAi`, `CategorizePlan` e `planCategorization(input, ai): Promise<CategorizePlan>`.
  - `processCategorize(data: { jobId; workspaceId; batchId? }, deps: { ai: OpenRouterGateway })` mantém a assinatura atual e grava `AiJob.result = { total, transfers, byRule, byAi, pending }`.

- [ ] **Step 1: Escrever os testes do gateway (devem falhar)**

Criar `apps/worker/test/categorize-gateway.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { OpenRouterGateway } from "../src/ai/openrouter";

const ok = (content: string, tokens = 50) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: tokens } }),
});

beforeEach(() => fetchMock.mockReset());

describe("OpenRouterGateway.categorizeBatch", () => {
  it("envia o schema de resposta, valida e devolve os resultados e o custo", async () => {
    fetchMock.mockResolvedValue(ok(JSON.stringify({ results: [{ transactionId: "t1", categoryId: "c1", confidence: 0.9 }] })));
    const gw = new OpenRouterGateway("key", "vision-x", "text-x");
    const out = await gw.categorizeBatch({ system: "sys", user: "usr" });
    expect(out).toEqual({ results: [{ transactionId: "t1", categoryId: "c1", confidence: 0.9 }], costTokens: 50 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe("text-x");
    expect(body.response_format.json_schema.name).toBe("categorize");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
    ]);
  });

  it("recupera JSON cercado de texto", async () => {
    fetchMock.mockResolvedValue(ok(`Claro! {"results":[{"transactionId":"t","categoryId":null,"confidence":0.1}]}`));
    const out = await new OpenRouterGateway("k", "v", "t").categorizeBatch({ system: "s", user: "u" });
    expect(out.results[0].categoryId).toBeNull();
  });

  it("lança em erro HTTP, JSON irrecuperável e confiança fora de 0–1", async () => {
    const gw = new OpenRouterGateway("k", "v", "t");
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    await expect(gw.categorizeBatch({ system: "s", user: "u" })).rejects.toThrow(/OpenRouter 500/);
    fetchMock.mockResolvedValueOnce(ok("sem json nenhum"));
    await expect(gw.categorizeBatch({ system: "s", user: "u" })).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(ok(JSON.stringify({ results: [{ transactionId: "t", categoryId: "c", confidence: 2 }] })));
    await expect(gw.categorizeBatch({ system: "s", user: "u" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/worker exec vitest run test/categorize-gateway.test.ts
```

Esperado: FAIL (`categorizeBatch is not a function`).

- [ ] **Step 3: Implementar o gateway**

Ler `apps/worker/src/ai/draft-schema.ts` e seguir o mesmo formato de `INVOICE_JSON_SCHEMA` (mesmas chaves no objeto exportado, inclusive `strict` se existir lá). Acrescentar ao final do arquivo:

```ts
export const CATEGORIZE_JSON_SCHEMA = {
  name: "categorize",
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            transactionId: { type: "string" },
            categoryId: { type: ["string", "null"] },
            confidence: { type: "number" },
          },
          required: ["transactionId", "categoryId", "confidence"],
        },
      },
    },
    required: ["results"],
  },
};
```

Em `apps/worker/src/ai/openrouter.ts`: acrescentar `CATEGORIZE_JSON_SCHEMA` ao import de `./draft-schema`, acrescentar `import { aiBatchResultSchema, type AiBatchResult } from "@app/shared";` e, dentro da classe, depois de `parseInvoiceText`:

```ts
  async categorizeBatch(input: { system: string; user: string }): Promise<{ results: AiBatchResult[]; costTokens: number | null }> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.textModel,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
        response_format: { type: "json_schema", json_schema: CATEGORIZE_JSON_SCHEMA },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content ?? '{"results":[]}';
    const parsed = aiBatchResultSchema.parse(this.repairParse(raw));
    return { results: parsed.results, costTokens: (data.usage?.total_tokens ?? null) as number | null };
  }
```

```bash
pnpm --filter @app/worker exec vitest run test/categorize-gateway.test.ts
```

Esperado: 3 testes passam.

- [ ] **Step 4: Escrever os testes do núcleo (devem falhar)**

Criar `apps/worker/test/categorize-core.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { TransferCandidate } from "@app/shared";
import {
  planCategorization,
  type CatCategory, type CatRule, type CatSettings, type CatTx, type CategorizeAi,
} from "../src/ai/categorize.core";

const SETTINGS: CatSettings = { aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] };

const CATS: CatCategory[] = [
  { id: "c-merc", name: "Supermercado", type: "expense", entity: "both" },
  { id: "c-forn", name: "Fornecedores", type: "expense", entity: "pj" },
  { id: "c-sal", name: "Salário", type: "income", entity: "both" },
];

let n = 0;
const tx = (over: Partial<CatTx> = {}): CatTx => ({
  id: `t${++n}`, type: "expense", amountCents: 1000, date: "2026-06-10", counterparty: null,
  description: "Compra qualquer", accountId: "a-pf", accountType: "checking", accountEntity: "pf", ...over,
});

const pool = (txs: CatTx[]): TransferCandidate[] =>
  txs.map((t) => ({ id: t.id, accountId: t.accountId!, accountType: t.accountType!, type: t.type, amountCents: t.amountCents, date: t.date, text: t.description ?? "" }));

function fakeAi(handler: (user: { categories: Array<{ id: string }>; transactions: Array<{ id: string }> }) => Array<{ transactionId: string; categoryId: string | null; confidence: number }>): CategorizeAi & { calls: number } {
  const ai = {
    calls: 0,
    categorizeBatch: vi.fn(async ({ user }: { system: string; user: string }) => {
      ai.calls++;
      return { results: handler(JSON.parse(user)), costTokens: 10 };
    }),
  };
  return ai;
}

const noAi = fakeAi(() => []);

describe("planCategorization", () => {
  it("pareia transferências internas e tira os lançamentos pareados dos passos seguintes", async () => {
    const saida = tx({ type: "expense", amountCents: 5000, accountId: "a-pj", accountEntity: "pj", description: "Pix enviado para STAEL EDSON" });
    const entrada = tx({ type: "income", amountCents: 5000, accountId: "a-pf", description: "Pix recebido de Empresa" });
    const ai = fakeAi(() => []);
    const plan = await planCategorization(
      { scope: [saida, entrada], pairPool: pool([saida, entrada]), categories: CATS, rules: [], examples: [], settings: SETTINGS }, ai,
    );
    expect(plan.transferPairs).toEqual([{ expenseId: saida.id, incomeId: entrada.id }]);
    expect(plan.byRule).toEqual([]);
    expect(plan.pending).toEqual([]);
    expect(ai.calls).toBe(0);
  });

  it("só aceita pares que envolvam um lançamento do escopo", async () => {
    const a = tx({ type: "expense", amountCents: 7000, accountId: "a-pj", accountEntity: "pj", description: "STAEL EDSON" });
    const b = tx({ type: "income", amountCents: 7000, accountId: "a-pf", description: "x" });
    const scope = tx({ description: "Outra coisa" });
    const plan = await planCategorization(
      { scope: [scope], pairPool: pool([a, b, scope]), categories: CATS, rules: [], examples: [], settings: SETTINGS }, fakeAi(() => []),
    );
    expect(plan.transferPairs).toEqual([]);
  });

  it("a regra vence a IA e a IA não é chamada para o que a regra resolveu", async () => {
    const t = tx({ description: "Supermercado Extra 123" });
    const rules: CatRule[] = [{ id: "r1", matchType: "contains", pattern: "supermercado", categoryId: "c-merc", priority: 100 }];
    const ai = fakeAi(() => []);
    const plan = await planCategorization({ scope: [t], pairPool: [], categories: CATS, rules, examples: [], settings: SETTINGS }, ai);
    expect(plan.byRule).toEqual([{ txId: t.id, categoryId: "c-merc", ruleId: "r1" }]);
    expect(ai.calls).toBe(0);
  });

  it("ignora regra cuja categoria não serve ao lançamento (entidade ou tipo) e cai na IA", async () => {
    const t = tx({ description: "Fornecedor Alfa", accountEntity: "pf" });
    const rules: CatRule[] = [{ id: "r1", matchType: "contains", pattern: "fornecedor", categoryId: "c-forn", priority: 100 }];
    const ai = fakeAi((u) => u.transactions.map((x) => ({ transactionId: x.id, categoryId: "c-merc", confidence: 0.95 })));
    const plan = await planCategorization({ scope: [t], pairPool: [], categories: CATS, rules, examples: [], settings: SETTINGS }, ai);
    expect(plan.byRule).toEqual([]);
    expect(plan.byAi).toEqual([{ txId: t.id, categoryId: "c-merc", confidence: 0.95 }]);
  });

  it("IA com confiança alta aplica; baixa vira pendente com sugestão; categoria incompatível e ausente viram pendentes sem sugestão", async () => {
    const alta = tx({ description: "a" });
    const baixa = tx({ description: "b" });
    const errada = tx({ description: "c" }); // despesa: c-sal é receita
    const faltando = tx({ description: "d" });
    const ai = fakeAi(() => [
      { transactionId: alta.id, categoryId: "c-merc", confidence: 0.9 },
      { transactionId: baixa.id, categoryId: "c-merc", confidence: 0.5 },
      { transactionId: errada.id, categoryId: "c-sal", confidence: 0.99 },
    ]);
    const plan = await planCategorization(
      { scope: [alta, baixa, errada, faltando], pairPool: [], categories: CATS, rules: [], examples: [], settings: SETTINGS }, ai,
    );
    expect(plan.byAi).toEqual([{ txId: alta.id, categoryId: "c-merc", confidence: 0.9 }]);
    expect(plan.pending).toEqual([
      { txId: baixa.id, suggestedCategoryId: "c-merc", confidence: 0.5 },
      { txId: errada.id, suggestedCategoryId: null, confidence: null },
      { txId: faltando.id, suggestedCategoryId: null, confidence: null },
    ]);
  });

  it("falha da IA deixa o lote inteiro pendente e não lança", async () => {
    const a = tx();
    const b = tx();
    const ai: CategorizeAi = { categorizeBatch: vi.fn(async () => { throw new Error("rede caiu"); }) };
    const plan = await planCategorization({ scope: [a, b], pairPool: [], categories: CATS, rules: [], examples: [], settings: SETTINGS }, ai);
    expect(plan.byAi).toEqual([]);
    expect(plan.pending.map((p) => p.txId)).toEqual([a.id, b.id]);
    expect(plan.costTokens).toBe(0);
  });

  it("divide em lotes do tamanho configurado e separa as chamadas por entidade", async () => {
    const pf = [tx(), tx(), tx(), tx(), tx()];
    const pj = [tx({ accountEntity: "pj", accountId: "a-pj" })];
    const ai = fakeAi((u) => u.transactions.map((x) => ({ transactionId: x.id, categoryId: "c-merc", confidence: 0.9 })));
    const plan = await planCategorization(
      { scope: [...pf, ...pj], pairPool: [], categories: CATS, rules: [], examples: [], settings: { ...SETTINGS, aiBatchSize: 2 } }, ai,
    );
    expect(ai.calls).toBe(4); // pf: 3 lotes (2+2+1), pj: 1 lote
    expect(plan.byAi).toHaveLength(6);
    expect(plan.costTokens).toBe(40);
  });

  it("oferece à IA só as categorias compatíveis com a entidade e os exemplos da mesma entidade", async () => {
    const t = tx({ accountEntity: "pf" });
    const seen: string[] = [];
    const ai: CategorizeAi = {
      categorizeBatch: vi.fn(async ({ user }) => { seen.push(user); return { results: [], costTokens: null }; }),
    };
    await planCategorization(
      {
        scope: [t], pairPool: [], categories: CATS, rules: [],
        examples: [
          { text: "padaria do zé", categoryName: "Supermercado", entity: "pf" },
          { text: "nota fiscal cliente", categoryName: "Fornecedores", entity: "pj" },
        ],
        settings: SETTINGS,
      }, ai,
    );
    const sent = JSON.parse(seen[0]) as { categories: Array<{ id: string }>; examples: Array<{ descricao: string }> };
    expect(sent.categories.map((c) => c.id).sort()).toEqual(["c-merc", "c-sal"]);
    expect(sent.examples.map((e) => e.descricao)).toEqual(["padaria do zé"]);
  });

  it("limita a 30 exemplos, os mais parecidos primeiro", async () => {
    const t = tx({ description: "uber viagem sp" });
    const examples = Array.from({ length: 40 }, (_, i) => ({ text: i === 39 ? "uber viagem rj" : `loja numero ${i}`, categoryName: "Supermercado", entity: "pf" as const }));
    const seen: string[] = [];
    const ai: CategorizeAi = { categorizeBatch: vi.fn(async ({ user }) => { seen.push(user); return { results: [], costTokens: null }; }) };
    await planCategorization({ scope: [t], pairPool: [], categories: CATS, rules: [], examples, settings: SETTINGS }, ai);
    const sent = JSON.parse(seen[0]) as { examples: Array<{ descricao: string }> };
    expect(sent.examples).toHaveLength(30);
    expect(sent.examples[0].descricao).toBe("uber viagem rj");
  });

  it("escopo vazio não chama a IA", async () => {
    const plan = await planCategorization({ scope: [], pairPool: [], categories: CATS, rules: [], examples: [], settings: SETTINGS }, noAi);
    expect(plan).toEqual({ transferPairs: [], byRule: [], byAi: [], pending: [], costTokens: 0 });
  });
});
```

- [ ] **Step 5: Rodar e confirmar a falha**

```bash
pnpm --filter @app/worker exec vitest run test/categorize-core.test.ts
```

Esperado: FAIL (módulo `categorize.core` inexistente).

- [ ] **Step 6: Implementar o núcleo**

Criar `apps/worker/src/ai/categorize.core.ts`:

```ts
import {
  categoryFits, chunk, decideAiResult, detectTransferPairs, matchRule, rankBySimilarity,
  type AccountEntity, type AccountType, type AiBatchResult, type CategoryEntity, type Rule, type TransferCandidate,
} from "@app/shared";

export interface CatTx {
  id: string;
  type: "income" | "expense";
  amountCents: number;
  date: string;
  counterparty: string | null;
  description: string | null;
  accountId: string | null;
  accountType: AccountType | null;
  accountEntity: AccountEntity | null;
}

export interface CatCategory {
  id: string;
  name: string;
  type: "income" | "expense";
  entity: CategoryEntity;
}

export interface CatRule extends Rule {
  id: string;
}

export interface CatExample {
  text: string;
  categoryName: string;
  entity: AccountEntity | null;
}

export interface CatSettings {
  aiConfidenceThreshold: number;
  aiBatchSize: number;
  transferMatchWindowDays: number;
  ownerNames: string[];
}

export interface CategorizeAi {
  categorizeBatch(input: { system: string; user: string }): Promise<{ results: AiBatchResult[]; costTokens: number | null }>;
}

export interface CategorizePlan {
  transferPairs: Array<{ expenseId: string; incomeId: string }>;
  byRule: Array<{ txId: string; categoryId: string; ruleId: string }>;
  byAi: Array<{ txId: string; categoryId: string; confidence: number }>;
  pending: Array<{ txId: string; suggestedCategoryId: string | null; confidence: number | null }>;
  costTokens: number;
}

const MAX_EXAMPLES = 30;

export const CATEGORIZE_SYSTEM =
  "Você classifica lançamentos financeiros brasileiros. Para cada lançamento, escolha UMA categoria da lista, " +
  "respeitando o tipo (income/expense). Se não tiver certeza, use categoryId null. " +
  "Informe a confiança de 0 a 1. Responda SOMENTE com o JSON do schema.";

export const txText = (tx: { counterparty: string | null; description: string | null }) =>
  [tx.counterparty, tx.description].filter(Boolean).join(" ");

function buildUserPrompt(batch: CatTx[], categories: CatCategory[], examples: CatExample[]): string {
  return JSON.stringify({
    categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    examples: examples.map((e) => ({ descricao: e.text, categoria: e.categoryName })),
    transactions: batch.map((t) => ({
      id: t.id,
      descricao: txText(t),
      valorCents: t.amountCents,
      tipo: t.type,
      conta: t.accountId,
    })),
  });
}

/**
 * Plano de categorização (sem tocar no banco): 1) pares de transferência interna; 2) regras compatíveis com o
 * lançamento; 3) IA em lotes, agrupada por entidade da conta, com limiar de confiança. Falha da IA deixa o lote pendente.
 */
export async function planCategorization(
  input: {
    scope: CatTx[];
    pairPool: TransferCandidate[];
    categories: CatCategory[];
    rules: CatRule[];
    examples: CatExample[];
    settings: CatSettings;
  },
  ai: CategorizeAi,
): Promise<CategorizePlan> {
  const { scope, categories, rules, examples, settings } = input;
  const plan: CategorizePlan = { transferPairs: [], byRule: [], byAi: [], pending: [], costTokens: 0 };
  if (scope.length === 0) return plan;

  const scopeIds = new Set(scope.map((t) => t.id));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const fits = (categoryId: string, tx: CatTx) => {
    const c = catById.get(categoryId);
    return !!c && categoryFits(c, tx, tx.accountEntity);
  };

  // 1. transferências internas (só pares que envolvem um lançamento do escopo)
  const paired = new Set<string>();
  const pairs = detectTransferPairs(input.pairPool, {
    ownerNames: settings.ownerNames,
    windowDays: settings.transferMatchWindowDays,
  });
  for (const [expenseId, incomeId] of pairs) {
    if (!scopeIds.has(expenseId) && !scopeIds.has(incomeId)) continue;
    plan.transferPairs.push({ expenseId, incomeId });
    paired.add(expenseId);
    paired.add(incomeId);
  }

  // 2. regras
  const remaining: CatTx[] = [];
  for (const tx of scope) {
    if (paired.has(tx.id)) continue;
    const compatible = rules.filter((r) => fits(r.categoryId, tx));
    const hit = matchRule(txText(tx), compatible);
    if (hit) plan.byRule.push({ txId: tx.id, categoryId: hit.categoryId, ruleId: hit.id });
    else remaining.push(tx);
  }

  // 3. IA em lote, uma entidade por vez
  const byEntity = new Map<AccountEntity | null, CatTx[]>();
  for (const tx of remaining) {
    const group = byEntity.get(tx.accountEntity);
    if (group) group.push(tx);
    else byEntity.set(tx.accountEntity, [tx]);
  }

  for (const [entity, txs] of byEntity) {
    const offered = categories.filter((c) => !entity || c.entity === "both" || c.entity === entity);
    const sameEntityExamples = examples.filter((e) => !entity || e.entity === entity);
    for (const batch of chunk(txs, settings.aiBatchSize)) {
      const target = batch.map(txText).join(" ");
      const shots = rankBySimilarity(sameEntityExamples, (e) => e.text, target, MAX_EXAMPLES);
      let results: AiBatchResult[] | null = null;
      try {
        const out = await ai.categorizeBatch({ system: CATEGORIZE_SYSTEM, user: buildUserPrompt(batch, offered, shots) });
        results = out.results;
        plan.costTokens += out.costTokens ?? 0;
      } catch {
        results = null; // falha da IA nunca derruba o job: o lote inteiro fica pendente
      }
      const byId = new Map((results ?? []).map((r) => [r.transactionId, r]));
      for (const tx of batch) {
        const decision = decideAiResult(byId.get(tx.id), (id) => fits(id, tx), settings.aiConfidenceThreshold);
        if (decision.status === "ok") {
          plan.byAi.push({ txId: tx.id, categoryId: decision.categoryId, confidence: decision.confidence });
        } else {
          plan.pending.push({ txId: tx.id, suggestedCategoryId: decision.suggestedCategoryId, confidence: decision.confidence });
        }
      }
    }
  }

  return plan;
}
```

```bash
pnpm --filter @app/worker exec vitest run test/categorize-core.test.ts
```

Esperado: 10 testes passam.

- [ ] **Step 7: Escrever o teste do wrapper (deve falhar)**

Criar `apps/worker/test/categorize-processor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => {
  const op = (name: string) => vi.fn((args: unknown) => ({ op: name, args }));
  return {
    settings: vi.fn(),
    txFindMany: vi.fn(),
    categories: vi.fn(),
    rules: vi.fn(),
    txUpdate: op("transaction.update"),
    txUpdateMany: op("transaction.updateMany"),
    ruleUpdate: op("categoryRule.update"),
    jobUpdate: op("aiJob.update"),
    transaction: vi.fn(async (ops: unknown[]) => ops),
  };
});

vi.mock("../src/database", () => ({
  prisma: {
    workspaceSettings: { findUnique: db.settings },
    transaction: { findMany: db.txFindMany, update: db.txUpdate, updateMany: db.txUpdateMany },
    category: { findMany: db.categories },
    categoryRule: { findMany: db.rules, update: db.ruleUpdate },
    aiJob: { update: db.jobUpdate },
    $transaction: db.transaction,
  },
}));

import { processCategorize } from "../src/ai/categorize.processor";

type Row = Record<string, unknown>;
const row = (id: string, over: Row = {}): Row => ({
  id, type: "expense", amountCents: 1000n, date: new Date("2026-06-10"), counterparty: null, description: "Compra",
  accountId: "a-pf", account: { type: "checking", entity: "pf" }, ...over,
});

function setup(scope: Row[], opts: { pool?: Row[]; examples?: Row[]; aiFails?: boolean } = {}) {
  db.settings.mockResolvedValue(null);
  db.categories.mockResolvedValue([{ id: "c-merc", name: "Supermercado", type: "expense", entity: "both" }]);
  db.rules.mockResolvedValue([{ id: "r1", matchType: "contains", pattern: "supermercado", categoryId: "c-merc", priority: 100 }]);
  db.txFindMany.mockImplementation(async (args: { where: Row }) => {
    if ("categorySource" in args.where && typeof args.where["categorySource"] === "object") return opts.examples ?? [];
    if ("date" in args.where) return opts.pool ?? scope;
    return scope;
  });
  const ai = {
    categorizeBatch: opts.aiFails
      ? vi.fn(async () => { throw new Error("sem rede"); })
      : vi.fn(async ({ user }: { user: string }) => ({
          results: (JSON.parse(user).transactions as Array<{ id: string }>).map((t) => ({ transactionId: t.id, categoryId: "c-merc", confidence: 0.95 })),
          costTokens: 7,
        })),
  };
  return ai;
}

beforeEach(() => Object.values(db).forEach((m) => "mockClear" in m && (m as { mockClear: () => void }).mockClear()));

const ops = () => (db.transaction.mock.calls[0][0] as Array<{ op: string; args: Row }>);

describe("processCategorize", () => {
  it("aplica regra, IA e pendência em uma transação e grava o resultado no job", async () => {
    const ai = setup([
      row("t-regra", { description: "Supermercado Extra" }),
      row("t-ia", { description: "Coisa estranha" }),
    ]);
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const all = ops();
    const rule = all.find((o) => o.op === "transaction.update" && (o.args.where as Row).id === "t-regra")!;
    expect(rule.args.data).toMatchObject({ categoryId: "c-merc", categorySource: "rule", categoryConfidence: 1, reviewStatus: "ok", suggestedCategoryId: null });
    const aiHit = all.find((o) => o.op === "transaction.update" && (o.args.where as Row).id === "t-ia")!;
    expect(aiHit.args.data).toMatchObject({ categoryId: "c-merc", categorySource: "ai", categoryConfidence: 0.95, reviewStatus: "ok" });
    expect(all.find((o) => o.op === "categoryRule.update")!.args).toEqual({ where: { id: "r1" }, data: { hitCount: { increment: 1 } } });
    const job = all.find((o) => o.op === "aiJob.update")!;
    expect(job.args.data).toMatchObject({ status: "done", costTokens: 7, result: { total: 2, transfers: 0, byRule: 1, byAi: 1, pending: 0 } });
  });

  it("falha da IA deixa pendente, sem sugestão, e o job termina done", async () => {
    const ai = setup([row("t1", { description: "Coisa estranha" })], { aiFails: true });
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    const pending = ops().find((o) => o.op === "transaction.update")!;
    expect(pending.args.data).toEqual({ reviewStatus: "pending", suggestedCategoryId: null, categoryConfidence: null });
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ status: "done", result: { pending: 1 } });
  });

  it("pareia transferência usando os nomes do titular configurados", async () => {
    db.settings.mockResolvedValue({ aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] });
    const saida = row("s", { description: "Pix para STAEL EDSON", accountId: "a-pj", account: { type: "checking", entity: "pj" } });
    const entrada = row("e", { type: "income", description: "Pix recebido", accountId: "a-pf" });
    const ai = setup([saida, entrada]);
    db.settings.mockResolvedValue({ aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: ["Stael Edson"] });
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });

    const pair = ops().find((o) => o.op === "transaction.updateMany")!;
    expect((pair.args.where as { id: { in: string[] } }).id.in.sort()).toEqual(["e", "s"]);
    expect(pair.args.data).toMatchObject({ reviewStatus: "ok" });
    expect(typeof (pair.args.data as Row).transferPairId).toBe("string");
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({ result: { transfers: 1 } });
    expect(ai.categorizeBatch).not.toHaveBeenCalled();
  });

  it("com batchId só olha o lote e o que ainda não foi categorizado; sem batchId olha pendentes e sem categoria", async () => {
    const ai = setup([]);
    await processCategorize({ jobId: "job1", workspaceId: "w1", batchId: "b1" }, { ai: ai as never });
    expect(db.txFindMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "w1", importBatchId: "b1", categorySource: "none", ignored: false, transferPairId: null });

    db.txFindMany.mockClear();
    await processCategorize({ jobId: "job2", workspaceId: "w1" }, { ai: setup([]) as never });
    expect(db.txFindMany.mock.calls[0][0].where.OR).toEqual([{ reviewStatus: "pending" }, { categorySource: "none" }]);
  });

  it("escopo vazio só fecha o job com zeros", async () => {
    const ai = setup([]);
    await processCategorize({ jobId: "job1", workspaceId: "w1" }, { ai: ai as never });
    expect(ai.categorizeBatch).not.toHaveBeenCalled();
    expect(ops().find((o) => o.op === "aiJob.update")!.args.data).toMatchObject({
      status: "done", result: { total: 0, transfers: 0, byRule: 0, byAi: 0, pending: 0 },
    });
  });
});
```

- [ ] **Step 8: Rodar e confirmar a falha**

```bash
pnpm --filter @app/worker exec vitest run test/categorize-processor.test.ts
```

Esperado: FAIL (o processor antigo não usa `$transaction`, settings nem `ignored`).

- [ ] **Step 9: Reescrever o job**

Substituir `apps/worker/src/ai/categorize.processor.ts` por:

```ts
import { randomUUID } from "node:crypto";
import { DEFAULT_WORKSPACE_SETTINGS, type AccountEntity, type AccountType, type TransferCandidate } from "@app/shared";
import { prisma } from "../database";
import {
  planCategorization,
  txText,
  type CatCategory, type CatExample, type CatRule, type CatTx, type CategorizeAi,
} from "./categorize.core";

export interface CategorizeJobData {
  jobId: string;
  workspaceId: string;
  /** Quando informado, categoriza só as transações desse lote de importação. */
  batchId?: string;
}

const DAY_MS = 86_400_000;
const EXAMPLE_POOL = 300;

const TX_SELECT = {
  id: true,
  type: true,
  amountCents: true,
  date: true,
  counterparty: true,
  description: true,
  accountId: true,
  account: { select: { type: true, entity: true } },
} as const;

type TxRow = {
  id: string;
  type: "income" | "expense" | "transfer";
  amountCents: bigint;
  date: Date;
  counterparty: string | null;
  description: string | null;
  accountId: string | null;
  account: { type: AccountType; entity: AccountEntity } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

function toCatTx(r: TxRow): CatTx {
  return {
    id: r.id,
    type: r.type as "income" | "expense",
    amountCents: Number(r.amountCents),
    date: iso(r.date),
    counterparty: r.counterparty,
    description: r.description,
    accountId: r.accountId,
    accountType: r.account?.type ?? null,
    accountEntity: r.account?.entity ?? null,
  };
}

export async function processCategorize(data: CategorizeJobData, deps: { ai: CategorizeAi }) {
  const { jobId, workspaceId, batchId } = data;

  const settingsRow = await prisma.workspaceSettings.findUnique({
    where: { workspaceId },
    select: { aiConfidenceThreshold: true, aiBatchSize: true, transferMatchWindowDays: true, ownerNames: true },
  });
  const settings = settingsRow ?? DEFAULT_WORKSPACE_SETTINGS;

  const base = { workspaceId, type: { in: ["income", "expense"] as Array<"income" | "expense"> }, ignored: false, transferPairId: null, categoryId: null };
  const scopeRows = (await prisma.transaction.findMany({
    where: batchId
      ? { ...base, importBatchId: batchId, categorySource: "none" }
      : { ...base, OR: [{ reviewStatus: "pending" }, { categorySource: "none" }] },
    select: TX_SELECT,
  })) as unknown as TxRow[];
  const scope = scopeRows.map(toCatTx);

  if (scope.length === 0) {
    await prisma.$transaction([
      prisma.aiJob.update({
        where: { id: jobId },
        data: { status: "done", result: { total: 0, transfers: 0, byRule: 0, byAi: 0, pending: 0 } },
      }),
    ]);
    return;
  }

  const times = scope.map((t) => Date.parse(`${t.date}T00:00:00Z`));
  const windowMs = settings.transferMatchWindowDays * DAY_MS;
  const poolRows = (await prisma.transaction.findMany({
    where: {
      ...base,
      categoryId: undefined,
      date: { gte: new Date(Math.min(...times) - windowMs), lte: new Date(Math.max(...times) + windowMs) },
    },
    select: TX_SELECT,
  })) as unknown as TxRow[];
  const pairPool: TransferCandidate[] = poolRows
    .filter((r) => r.accountId && r.account)
    .map((r) => ({
      id: r.id,
      accountId: r.accountId!,
      accountType: r.account!.type,
      type: r.type as "income" | "expense",
      amountCents: Number(r.amountCents),
      date: iso(r.date),
      text: txText(r),
    }));

  const [categories, rules] = await Promise.all([
    prisma.category.findMany({ where: { workspaceId }, select: { id: true, name: true, type: true, entity: true } }),
    prisma.categoryRule.findMany({
      where: { workspaceId },
      orderBy: { priority: "desc" },
      select: { id: true, matchType: true, pattern: true, categoryId: true, priority: true },
    }),
  ]);

  const entities = new Set<AccountEntity | null>(scope.map((t) => t.accountEntity));
  const examples: CatExample[] = [];
  for (const entity of entities) {
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        categorySource: { in: ["manual", "rule"] },
        categoryId: { not: null },
        ...(entity ? { account: { entity } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: EXAMPLE_POOL,
      select: { counterparty: true, description: true, category: { select: { name: true } }, account: { select: { entity: true } } },
    });
    for (const r of rows) {
      examples.push({ text: txText(r), categoryName: r.category?.name ?? "", entity: r.account?.entity ?? null });
    }
  }

  const plan = await planCategorization(
    {
      scope,
      pairPool,
      categories: categories as CatCategory[],
      rules: rules as CatRule[],
      examples,
      settings,
    },
    deps.ai,
  );

  const ruleHits = new Map<string, number>();
  for (const h of plan.byRule) ruleHits.set(h.ruleId, (ruleHits.get(h.ruleId) ?? 0) + 1);

  await prisma.$transaction([
    ...plan.transferPairs.map((p) =>
      prisma.transaction.updateMany({
        where: { id: { in: [p.expenseId, p.incomeId] }, workspaceId },
        data: { transferPairId: randomUUID(), reviewStatus: "ok" },
      }),
    ),
    ...plan.byRule.map((h) =>
      prisma.transaction.update({
        where: { id: h.txId },
        data: { categoryId: h.categoryId, categorySource: "rule", categoryConfidence: 1, reviewStatus: "ok", suggestedCategoryId: null },
      }),
    ),
    ...[...ruleHits].map(([id, n]) => prisma.categoryRule.update({ where: { id }, data: { hitCount: { increment: n } } })),
    ...plan.byAi.map((h) =>
      prisma.transaction.update({
        where: { id: h.txId },
        data: { categoryId: h.categoryId, categorySource: "ai", categoryConfidence: h.confidence, reviewStatus: "ok", suggestedCategoryId: null },
      }),
    ),
    ...plan.pending.map((p) =>
      prisma.transaction.update({
        where: { id: p.txId },
        data: { reviewStatus: "pending", suggestedCategoryId: p.suggestedCategoryId, categoryConfidence: p.confidence },
      }),
    ),
    prisma.aiJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        costTokens: plan.costTokens || null,
        result: {
          total: scope.length,
          transfers: plan.transferPairs.length,
          byRule: plan.byRule.length,
          byAi: plan.byAi.length,
          pending: plan.pending.length,
        },
      },
    }),
  ]);
}
```

Em `apps/worker/src/ai/ingest.processor.ts`, a chamada `processCategorize({ jobId, workspaceId, batchId }, { ai: deps.ai })` já casa com a nova assinatura (o `OpenRouterGateway` implementa `CategorizeAi`); remover a linha redundante `await prisma.aiJob.update({ where: { id: jobId }, data: { status: "done" } });` logo depois dela **apenas se** o typecheck acusar conflito; caso contrário deixar como está.

Observação de tipos: se o TypeScript reclamar do literal `categoryId: undefined` no objeto `where` do `poolRows` (o spread de `base` traz `categoryId: null`), remover `categoryId` de `base` e acrescentá-lo só à consulta do escopo (`{ ...base, categoryId: null, importBatchId: … }`). O pool de transferências **não** filtra por categoria, porque uma transferência pode ter categoria herdada.

```bash
pnpm --filter @app/worker test
pnpm --filter @app/worker typecheck
```

Esperado: todos passam (22 anteriores − os testes antigos que dependiam do comportamento removido, se existirem, mais 3 + 10 + 5 novos) e typecheck verde. Se existir um teste antigo do `processCategorize` que quebre por causa do comportamento novo, reescrevê-lo para o contrato novo em vez de removê-lo e listar a mudança no relatório.

- [ ] **Step 10: Commit**

```bash
git add apps/worker
git commit -m "$(cat <<'EOF'
feat(worker): categorização em lote (transferências, regras, IA com limiar) com núcleo testável e fila de pendentes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: API — fila de revisão e categorização manual

**Files:**
- Create: `apps/api/src/common/similar-transactions.ts`
- Create: `apps/api/src/review/review.service.ts`, `review.controller.ts`, `review.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/transactions/transactions.service.ts`, `transactions.controller.ts`
- Modify: `apps/api/src/category-rules/category-rules.service.ts`
- Create: `apps/api/test/e2e/revisao.e2e.test.ts`

**Interfaces:**
- Consumes (Tasks 1–2): campos novos do Prisma; `normalizeDescriptionKey`, `categoryFits`, `ruleFromCorrection` de `@app/shared`; `TransactionsService.enqueueCategorizationJob(workspaceId, userId, batchId?)`; `CategoryRulesService.learnFromCorrection`.
- Produces (todas exigem autenticação e são escopadas ao workspace):
  - `GET /review/pending?entity=pf|pj&accountId=` → `{ total: number; groups: Array<{ key: string; type: "income" | "expense"; description: string; count: number; totalCents: number; entity: "pf" | "pj" | null; suggestedCategoryId: string | null; transactionIds: string[] }> }`, ordenado por `totalCents` decrescente. Só entram `reviewStatus = pending`, não ignorados, sem `transferPairId`.
  - `POST /review/categorize` body `{ transactionIds: string[]; categoryId: string; createRule?: boolean (padrão true); applyToSimilar?: boolean (padrão false) }` → `{ updated: number; similarUpdated: number; ruleCreated: boolean }`. 404 se a categoria ou algum lançamento não é do workspace; 400 se a categoria não serve a algum lançamento (`categoryFits`).
  - `POST /review/accept-suggestion` body `{ transactionIds: string[] }` → `{ accepted: number; skipped: number }`.
  - `POST /review/mark-transfer` body `{ transactionId, counterpartTransactionId }` → `{ transferPairId: string }`; 400 se as contas são iguais, os tipos são iguais, os valores diferem ou algum já está pareado.
  - `POST /review/unpair` body `{ transferPairId }` → `{ unpaired: number }` (volta a `reviewStatus = pending`, `categorySource = none`).
  - `POST /review/ignore` body `{ transactionIds: string[] }` → `{ ignored: number }`.
  - `POST /review/recategorize` → `201 { id }` (job `categorize` sem lote).
  - `GET /review/transfer-candidates?transactionId=` → lançamentos de outra conta, sentido oposto, mesmo valor, até 7 dias, sem par e não ignorados: `Array<{ id, date, amountCents, description, accountName }>`.
  - `PATCH /transactions/:id/category` body `{ categoryId: string | null; applyToSimilar?: boolean }` → `{ id, categoryId, similarCount }`; grava `categorySource = manual` (ou `none` se `categoryId` nulo), `reviewStatus = ok`; 400 se a categoria não serve.
  - `GET /category-rules` passa a incluir `hitCount`.

- [ ] **Step 1: Escrever os testes e2e (devem falhar)**

Criar `apps/api/test/e2e/revisao.e2e.test.ts`:

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
type User = Awaited<ReturnType<typeof newUser>>;

const account = (u: User, name: string, entity: "pf" | "pj", extra: Record<string, unknown> = {}) =>
  prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name, entity, ...extra } });

const category = (u: User, name: string, type: "income" | "expense", entity: "pf" | "pj" | "both" = "both") =>
  prisma.category.create({ data: { workspaceId: u.workspaceId, name, type, entity } });

let seq = 0;
function tx(u: User, accountId: string, over: Record<string, unknown> = {}) {
  return prisma.transaction.create({
    data: {
      workspaceId: u.workspaceId, type: "expense", amountCents: 1000n, date: new Date("2026-06-10"), accountId,
      description: "Compra", source: "import", createdById: u.userId, importFingerprint: `fp-${Date.now()}-${++seq}`,
      reviewStatus: "pending", ...over,
    } as never,
  });
}

const get = (u: User, url: string) => app.inject({ method: "GET", url, headers: u.h });
const post = (u: User, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });

describe("GET /review/pending", () => {
  it("agrupa por tipo e descrição normalizada, soma valores e escolhe a sugestão mais comum", async () => {
    const u = await newUser("rev1");
    const acc = await account(u, "Conta PF", "pf");
    const sug = await category(u, "Restaurantes", "expense");
    await tx(u, acc.id, { description: "iFood *Pedido 111", amountCents: 3000n, suggestedCategoryId: sug.id });
    await tx(u, acc.id, { description: "IFOOD pedido 222", amountCents: 2000n, suggestedCategoryId: sug.id });
    await tx(u, acc.id, { description: "Padaria", amountCents: 500n });
    await tx(u, acc.id, { description: "iFood Pedido", type: "income", amountCents: 100n });

    const res = await get(u, "/review/pending");
    expect(res.statusCode).toBe(200);
    const { total, groups } = res.json();
    expect(total).toBe(4);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ type: "expense", count: 2, totalCents: 5000, entity: "pf", suggestedCategoryId: sug.id });
    expect(groups[0].transactionIds).toHaveLength(2);
    expect(groups.map((g: { totalCents: number }) => g.totalCents)).toEqual([5000, 500, 100]);
  });

  it("não lista ignorados, pareados nem já revisados; filtra por entidade e conta", async () => {
    const u = await newUser("rev2");
    const pf = await account(u, "PF", "pf");
    const pj = await account(u, "PJ", "pj");
    await tx(u, pf.id, { description: "pendente pf" });
    await tx(u, pj.id, { description: "pendente pj" });
    await tx(u, pf.id, { description: "ignorado", ignored: true });
    await tx(u, pf.id, { description: "pareado", transferPairId: "p1" });
    await tx(u, pf.id, { description: "revisado", reviewStatus: "ok" });

    expect((await get(u, "/review/pending")).json().total).toBe(2);
    const onlyPj = (await get(u, "/review/pending?entity=pj")).json();
    expect(onlyPj.groups.map((g: { description: string }) => g.description)).toEqual(["pendente pj"]);
    const onlyAcc = (await get(u, `/review/pending?accountId=${pf.id}`)).json();
    expect(onlyAcc.total).toBe(1);
    expect((await get(u, "/review/pending?entity=xx")).statusCode).toBe(400);
  });

  it("é isolado por workspace", async () => {
    const a = await newUser("rev3a");
    const b = await newUser("rev3b");
    await tx(a, (await account(a, "PF", "pf")).id);
    expect((await get(b, "/review/pending")).json().total).toBe(0);
  });
});

describe("POST /review/categorize", () => {
  it("categoriza o grupo como manual, cria a regra e zera a revisão", async () => {
    const u = await newUser("cat1");
    const acc = await account(u, "PF", "pf");
    const merc = await category(u, "Supermercado", "expense");
    const t1 = await tx(u, acc.id, { description: "Mercado Bom 1", suggestedCategoryId: merc.id, categoryConfidence: 0.5 });
    const t2 = await tx(u, acc.id, { description: "Mercado Bom 2" });

    const res = await post(u, "/review/categorize", { transactionIds: [t1.id, t2.id], categoryId: merc.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2, similarUpdated: 0, ruleCreated: true });

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: t1.id } });
    expect(after).toMatchObject({ categoryId: merc.id, categorySource: "manual", reviewStatus: "ok", suggestedCategoryId: null, categoryConfidence: null });

    const rules = (await get(u, "/category-rules")).json() as Array<{ categoryId: string; hitCount: number }>;
    expect(rules.find((r) => r.categoryId === merc.id)).toMatchObject({ hitCount: 0 });
  });

  it("createRule=false não cria regra", async () => {
    const u = await newUser("cat2");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Lazer", "expense");
    const t = await tx(u, acc.id, { description: "Cinema" });
    const res = await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: c.id, createRule: false });
    expect(res.json().ruleCreated).toBe(false);
    expect((await get(u, "/category-rules")).json()).toHaveLength(0);
  });

  it("applyToSimilar leva junto os pendentes de mesma descrição e tipo, sem tocar nos demais", async () => {
    const u = await newUser("cat3");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Assinaturas", "expense");
    const sel = await tx(u, acc.id, { description: "Netflix 01/2026" });
    const parecido = await tx(u, acc.id, { description: "NETFLIX 02/2026" });
    const semCategoria = await tx(u, acc.id, { description: "Netflix 03/2026", reviewStatus: "ok", categorySource: "none" });
    const outroTipo = await tx(u, acc.id, { description: "Netflix reembolso", type: "income" });
    const outraDesc = await tx(u, acc.id, { description: "Spotify" });
    const jaCategorizado = await tx(u, acc.id, { description: "Netflix 04/2026", reviewStatus: "ok", categorySource: "manual" });

    const res = await post(u, "/review/categorize", { transactionIds: [sel.id], categoryId: c.id, applyToSimilar: true });
    expect(res.json()).toMatchObject({ updated: 3, similarUpdated: 2 });

    const cat = async (id: string) => (await prisma.transaction.findUniqueOrThrow({ where: { id } })).categoryId;
    expect(await cat(parecido.id)).toBe(c.id);
    expect(await cat(semCategoria.id)).toBe(c.id);
    expect(await cat(outroTipo.id)).toBeNull();
    expect(await cat(outraDesc.id)).toBeNull();
    expect(await cat(jaCategorizado.id)).toBeNull();
  });

  it("recusa categoria de tipo errado ou de entidade errada (400) e categoria/lançamento de outro workspace (404)", async () => {
    const u = await newUser("cat4");
    const other = await newUser("cat4b");
    const acc = await account(u, "PF", "pf");
    const t = await tx(u, acc.id);
    const receita = await category(u, "Salário x", "income");
    const soPj = await category(u, "Fornecedores x", "expense", "pj");
    const alheia = await category(other, "Alheia", "expense");

    expect((await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: receita.id })).statusCode).toBe(400);
    expect((await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: soPj.id })).statusCode).toBe(400);
    expect((await post(u, "/review/categorize", { transactionIds: [t.id], categoryId: alheia.id })).statusCode).toBe(404);
    expect((await post(other, "/review/categorize", { transactionIds: [t.id], categoryId: alheia.id })).statusCode).toBe(404);
    expect((await post(u, "/review/categorize", { transactionIds: [], categoryId: alheia.id })).statusCode).toBe(400);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).categoryId).toBeNull();
  });
});

describe("POST /review/accept-suggestion", () => {
  it("aplica a sugestão como ai e pula o que não tem sugestão ou ficou incompatível", async () => {
    const u = await newUser("acc1");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Transporte x", "expense");
    const incompat = await category(u, "Só PJ", "expense", "pj");
    const comSug = await tx(u, acc.id, { suggestedCategoryId: c.id, categoryConfidence: 0.6 });
    const semSug = await tx(u, acc.id);
    const incomp = await tx(u, acc.id, { suggestedCategoryId: incompat.id });

    const res = await post(u, "/review/accept-suggestion", { transactionIds: [comSug.id, semSug.id, incomp.id] });
    expect(res.json()).toEqual({ accepted: 1, skipped: 2 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: comSug.id } })).toMatchObject({
      categoryId: c.id, categorySource: "ai", reviewStatus: "ok", suggestedCategoryId: null, categoryConfidence: 0.6,
    });
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: semSug.id } })).categoryId).toBeNull();
  });
});

describe("transferências e ignorar", () => {
  async function par(u: User) {
    const pj = await account(u, "PJ", "pj");
    const pf = await account(u, "PF", "pf");
    const saida = await tx(u, pj.id, { description: "Pix enviado", amountCents: 5000n });
    const entrada = await tx(u, pf.id, { description: "Pix recebido", type: "income", amountCents: 5000n });
    return { pj, pf, saida, entrada };
  }

  it("marca e desfaz o par de transferência", async () => {
    const u = await newUser("tr1");
    const { saida, entrada } = await par(u);
    const res = await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id });
    expect(res.statusCode).toBe(200);
    const { transferPairId } = res.json();
    const pair = await prisma.transaction.findMany({ where: { transferPairId } });
    expect(pair).toHaveLength(2);
    expect(pair.every((t) => t.reviewStatus === "ok")).toBe(true);
    expect((await get(u, "/review/pending")).json().total).toBe(0);

    const un = await post(u, "/review/unpair", { transferPairId });
    expect(un.json()).toEqual({ unpaired: 2 });
    const back = await prisma.transaction.findUniqueOrThrow({ where: { id: saida.id } });
    expect(back).toMatchObject({ transferPairId: null, reviewStatus: "pending", categorySource: "none" });
  });

  it("recusa par inválido (mesma conta, mesmo sentido, valor diferente, já pareado) e lançamento alheio", async () => {
    const u = await newUser("tr2");
    const other = await newUser("tr2b");
    const { pj, saida, entrada } = await par(u);
    const mesmaConta = await tx(u, pj.id, { type: "income", amountCents: 5000n });
    const mesmoSentido = await tx(u, (await account(u, "Outra", "pf")).id, { amountCents: 5000n });
    const valor = await tx(u, (await account(u, "Outra2", "pf")).id, { type: "income", amountCents: 4999n });

    const bad = async (other: string) => (await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: other })).statusCode;
    expect(await bad(mesmaConta.id)).toBe(400);
    expect(await bad(mesmoSentido.id)).toBe(400);
    expect(await bad(valor.id)).toBe(400);
    expect((await post(other, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id })).statusCode).toBe(404);

    expect((await post(u, "/review/mark-transfer", { transactionId: saida.id, counterpartTransactionId: entrada.id })).statusCode).toBe(200);
    expect(await bad(entrada.id)).toBe(400); // já pareados
  });

  it("lista as contrapartes possíveis", async () => {
    const u = await newUser("tr3");
    const { saida, entrada } = await par(u);
    await tx(u, (await account(u, "X", "pf")).id, { type: "income", amountCents: 5000n, date: new Date("2026-07-20"), description: "longe" });
    const res = await get(u, `/review/transfer-candidates?transactionId=${saida.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { id: string }) => c.id)).toEqual([entrada.id]);
    expect(res.json()[0]).toMatchObject({ accountName: "PF", amountCents: 5000, description: "Pix recebido" });
  });

  it("ignora lançamentos: saem da fila e ficam marcados", async () => {
    const u = await newUser("ign1");
    const acc = await account(u, "PF", "pf");
    const t = await tx(u, acc.id);
    const res = await post(u, "/review/ignore", { transactionIds: [t.id] });
    expect(res.json()).toEqual({ ignored: 1 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ ignored: true, reviewStatus: "ok" });
    expect((await get(u, "/review/pending")).json().total).toBe(0);
  });

  it("recategorize enfileira um job categorize sem lote", async () => {
    const u = await newUser("rec1");
    const res = await post(u, "/review/recategorize");
    expect(res.statusCode).toBe(201);
    const job = await prisma.aiJob.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(job).toMatchObject({ kind: "categorize", inputRef: null, workspaceId: u.workspaceId });
  });
});

describe("PATCH /transactions/:id/category", () => {
  const patch = (u: User, id: string, payload: unknown) => app.inject({ method: "PATCH", url: `/transactions/${id}/category`, headers: u.h, payload: payload as object });

  it("grava como manual, zera a revisão e devolve similarCount", async () => {
    const u = await newUser("pat1");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Assinaturas p", "expense");
    const t = await tx(u, acc.id, { description: "Disney 1" });
    await tx(u, acc.id, { description: "Disney 2" });
    const res = await patch(u, t.id, { categoryId: c.id, applyToSimilar: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: t.id, categoryId: c.id, similarCount: 1 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ categorySource: "manual", reviewStatus: "ok" });
    expect((await prisma.transaction.count({ where: { workspaceId: u.workspaceId, categoryId: c.id } }))).toBe(2);
  });

  it("categoryId nulo volta para sem categoria; categoria incompatível retorna 400", async () => {
    const u = await newUser("pat2");
    const acc = await account(u, "PF", "pf");
    const c = await category(u, "Lazer p", "expense");
    const receita = await category(u, "Salário p", "income");
    const t = await tx(u, acc.id, { categoryId: c.id, categorySource: "manual", reviewStatus: "ok" });

    expect((await patch(u, t.id, { categoryId: receita.id })).statusCode).toBe(400);
    const res = await patch(u, t.id, { categoryId: null });
    expect(res.statusCode).toBe(200);
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ categoryId: null, categorySource: "none" });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/revisao.e2e.test.ts
```

Esperado: FAIL (rotas `/review/*` inexistentes → 404; o PATCH ainda não grava `categorySource`).

- [ ] **Step 3: Helper de lançamentos parecidos**

Criar `apps/api/src/common/similar-transactions.ts`:

```ts
import { categoryFits, normalizeDescriptionKey, type AccountEntity, type CategoryEntity } from "@app/shared";
import { prisma } from "../database";

const textOf = (t: { counterparty: string | null; description: string | null }) =>
  [t.counterparty, t.description].filter(Boolean).join(" ");

/**
 * Ids de lançamentos ainda sem categoria (pendentes ou `categorySource = none`, não ignorados, sem par) que têm a
 * mesma descrição normalizada e o mesmo tipo de algum dos `seeds`, e aos quais a categoria serve.
 */
export async function findSimilarUncategorizedIds(
  workspaceId: string,
  seeds: Array<{ id: string; type: "income" | "expense" | "transfer"; counterparty: string | null; description: string | null }>,
  category: { type: "income" | "expense"; entity: CategoryEntity },
): Promise<string[]> {
  const keys = new Set(seeds.map((s) => `${s.type}|${normalizeDescriptionKey(textOf(s))}`));
  if ([...keys].every((k) => k.endsWith("|"))) return [];
  const seedIds = new Set(seeds.map((s) => s.id));

  const candidates = await prisma.transaction.findMany({
    where: {
      workspaceId,
      type: category.type,
      ignored: false,
      transferPairId: null,
      OR: [{ reviewStatus: "pending" }, { categorySource: "none" }],
      categoryId: null,
    },
    select: { id: true, type: true, counterparty: true, description: true, account: { select: { entity: true } } },
  });

  return candidates
    .filter((c) => !seedIds.has(c.id))
    .filter((c) => keys.has(`${c.type}|${normalizeDescriptionKey(textOf(c))}`))
    .filter((c) => categoryFits(category, { type: c.type }, (c.account?.entity ?? null) as AccountEntity | null))
    .map((c) => c.id);
}
```

- [ ] **Step 4: `ReviewService`**

Criar `apps/api/src/review/review.service.ts`:

```ts
import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { categoryFits, normalizeDescriptionKey, type AccountEntity } from "@app/shared";
import { prisma } from "../database";
import { findSimilarUncategorizedIds } from "../common/similar-transactions";
import { CategoryRulesService } from "../category-rules/category-rules.service";
import { TransactionsService } from "../transactions/transactions.service";

const CANDIDATE_WINDOW_DAYS = 7;

const textOf = (t: { counterparty: string | null; description: string | null }) =>
  [t.counterparty, t.description].filter(Boolean).join(" ");

const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class ReviewService {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly rules: CategoryRulesService,
  ) {}

  async pending(workspaceId: string, filters: { entity?: AccountEntity; accountId?: string }) {
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        reviewStatus: "pending",
        ignored: false,
        transferPairId: null,
        type: { in: ["income", "expense"] },
        ...(filters.accountId ? { accountId: filters.accountId } : {}),
        ...(filters.entity ? { account: { entity: filters.entity } } : {}),
      },
      orderBy: [{ date: "desc" }, { id: "asc" }],
      select: {
        id: true, type: true, amountCents: true, counterparty: true, description: true,
        suggestedCategoryId: true, account: { select: { entity: true } },
      },
    });

    type Group = {
      key: string; type: "income" | "expense"; description: string; count: number; totalCents: number;
      entities: Set<string>; suggestions: Map<string, number>; transactionIds: string[];
    };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const text = textOf(r);
      const key = `${r.type}|${normalizeDescriptionKey(text) || "(sem descrição)"}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          key, type: r.type as "income" | "expense", description: text || "(sem descrição)", count: 0, totalCents: 0,
          entities: new Set(), suggestions: new Map(), transactionIds: [],
        };
        groups.set(key, g);
      }
      g.count++;
      g.totalCents += Number(r.amountCents);
      g.entities.add(r.account?.entity ?? "none");
      if (r.suggestedCategoryId) g.suggestions.set(r.suggestedCategoryId, (g.suggestions.get(r.suggestedCategoryId) ?? 0) + 1);
      g.transactionIds.push(r.id);
    }

    const out = [...groups.values()].map((g) => {
      const only = g.entities.size === 1 ? [...g.entities][0] : null;
      const suggested = [...g.suggestions].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        key: g.key, type: g.type, description: g.description, count: g.count, totalCents: g.totalCents,
        entity: only === "pf" || only === "pj" ? only : null,
        suggestedCategoryId: suggested, transactionIds: g.transactionIds,
      };
    });
    out.sort((a, b) => b.totalCents - a.totalCents);
    return { total: rows.length, groups: out };
  }

  private async loadTransactions(workspaceId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const txs = await prisma.transaction.findMany({
      where: { id: { in: unique }, workspaceId },
      select: { id: true, type: true, amountCents: true, date: true, accountId: true, counterparty: true, description: true, transferPairId: true, account: { select: { entity: true } } },
    });
    if (txs.length !== unique.length) throw new NotFoundException("lançamento não encontrado");
    return txs;
  }

  async categorize(
    workspaceId: string,
    dto: { transactionIds: string[]; categoryId: string; createRule: boolean; applyToSimilar: boolean },
  ) {
    const category = await prisma.category.findFirst({
      where: { id: dto.categoryId, workspaceId },
      select: { id: true, type: true, entity: true },
    });
    if (!category) throw new NotFoundException("categoria não encontrada");
    const txs = await this.loadTransactions(workspaceId, dto.transactionIds);
    for (const t of txs) {
      if (!categoryFits(category, t, (t.account?.entity ?? null) as AccountEntity | null)) {
        throw new BadRequestException("a categoria não serve a um dos lançamentos (tipo ou entidade)");
      }
    }

    const ids = new Set(txs.map((t) => t.id));
    let similarUpdated = 0;
    if (dto.applyToSimilar) {
      const similar = await findSimilarUncategorizedIds(workspaceId, txs, category);
      similar.forEach((id) => ids.add(id));
      similarUpdated = similar.length;
    }

    await prisma.transaction.updateMany({
      where: { id: { in: [...ids] }, workspaceId },
      data: { categoryId: category.id, categorySource: "manual", categoryConfidence: null, reviewStatus: "ok", suggestedCategoryId: null },
    });

    let ruleCreated = false;
    if (dto.createRule) {
      await this.rules.learnFromCorrection({ counterparty: txs[0].counterparty, description: txs[0].description }, category.id, workspaceId);
      ruleCreated = true;
    }
    return { updated: ids.size, similarUpdated, ruleCreated };
  }

  async acceptSuggestion(workspaceId: string, transactionIds: string[]) {
    const txs = await prisma.transaction.findMany({
      where: { id: { in: [...new Set(transactionIds)] }, workspaceId },
      select: { id: true, type: true, suggestedCategoryId: true, account: { select: { entity: true } } },
    });
    const withSuggestion = txs.filter((t) => t.suggestedCategoryId);
    const categories = await prisma.category.findMany({
      where: { workspaceId, id: { in: [...new Set(withSuggestion.map((t) => t.suggestedCategoryId!))] } },
      select: { id: true, type: true, entity: true },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));

    let accepted = 0;
    for (const t of withSuggestion) {
      const c = byId.get(t.suggestedCategoryId!);
      if (!c || !categoryFits(c, t, (t.account?.entity ?? null) as AccountEntity | null)) continue;
      await prisma.transaction.update({
        where: { id: t.id },
        data: { categoryId: c.id, categorySource: "ai", reviewStatus: "ok", suggestedCategoryId: null },
      });
      accepted++;
    }
    return { accepted, skipped: new Set(transactionIds).size - accepted };
  }

  async markTransfer(workspaceId: string, transactionId: string, counterpartTransactionId: string) {
    if (transactionId === counterpartTransactionId) throw new BadRequestException("os lançamentos precisam ser diferentes");
    const [a, b] = await this.loadTransactions(workspaceId, [transactionId, counterpartTransactionId]);
    const ok =
      a.accountId && b.accountId && a.accountId !== b.accountId &&
      a.type !== "transfer" && b.type !== "transfer" && a.type !== b.type &&
      Number(a.amountCents) === Number(b.amountCents) &&
      !a.transferPairId && !b.transferPairId;
    if (!ok) {
      throw new BadRequestException("não formam um par: contas diferentes, sentidos opostos, mesmo valor e sem par anterior");
    }
    const transferPairId = randomUUID();
    await prisma.transaction.updateMany({
      where: { id: { in: [a.id, b.id] }, workspaceId },
      data: { transferPairId, reviewStatus: "ok" },
    });
    return { transferPairId };
  }

  async unpair(workspaceId: string, transferPairId: string) {
    const { count } = await prisma.transaction.updateMany({
      where: { workspaceId, transferPairId },
      data: { transferPairId: null, reviewStatus: "pending", categorySource: "none" },
    });
    if (count === 0) throw new NotFoundException("par não encontrado");
    return { unpaired: count };
  }

  async ignore(workspaceId: string, transactionIds: string[]) {
    const { count } = await prisma.transaction.updateMany({
      where: { id: { in: [...new Set(transactionIds)] }, workspaceId },
      data: { ignored: true, reviewStatus: "ok" },
    });
    return { ignored: count };
  }

  recategorize(workspaceId: string, userId: string) {
    return this.transactions.enqueueCategorizationJob(workspaceId, userId);
  }

  async transferCandidates(workspaceId: string, transactionId: string) {
    const tx = await prisma.transaction.findFirst({
      where: { id: transactionId, workspaceId },
      select: { id: true, type: true, amountCents: true, date: true, accountId: true },
    });
    if (!tx || tx.type === "transfer") throw new NotFoundException("lançamento não encontrado");
    const from = new Date(tx.date.getTime() - CANDIDATE_WINDOW_DAYS * 86_400_000);
    const to = new Date(tx.date.getTime() + CANDIDATE_WINDOW_DAYS * 86_400_000);
    const rows = await prisma.transaction.findMany({
      where: {
        workspaceId,
        type: tx.type === "expense" ? "income" : "expense",
        amountCents: tx.amountCents,
        date: { gte: from, lte: to },
        accountId: { not: tx.accountId, notIn: [] },
        transferPairId: null,
        ignored: false,
      },
      orderBy: { date: "asc" },
      select: { id: true, date: true, amountCents: true, description: true, account: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id, date: iso(r.date), amountCents: Number(r.amountCents), description: r.description, accountName: r.account?.name ?? null,
    }));
  }
}
```

Observação: se o Prisma não aceitar `accountId: { not: tx.accountId, notIn: [] }`, usar só `accountId: { not: tx.accountId }` e filtrar `accountId !== null` em memória (contrapartes sem conta não servem).

- [ ] **Step 5: Controller, módulo e registro**

Criar `apps/api/src/review/review.controller.ts`:

```ts
import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { parseEntityQuery } from "../common/entity-query";
import { ReviewService } from "./review.service";

const ids = z.array(z.string().min(1)).min(1).max(1000);
const categorizeBody = z.object({
  transactionIds: ids,
  categoryId: z.string().min(1),
  createRule: z.boolean().default(true),
  applyToSimilar: z.boolean().default(false),
});
const idsBody = z.object({ transactionIds: ids });
const markBody = z.object({ transactionId: z.string().min(1), counterpartTransactionId: z.string().min(1) });
const unpairBody = z.object({ transferPairId: z.string().min(1) });

@Controller("review")
@UseGuards(CurrentUserGuard)
export class ReviewController {
  constructor(private readonly service: ReviewService) {}

  @Get("pending")
  pending(@CurrentUser() user: AuthenticatedUser, @Query("entity") entity?: string, @Query("accountId") accountId?: string) {
    return this.service.pending(user.workspaceId, { entity: parseEntityQuery(entity), accountId: accountId || undefined });
  }

  @Post("categorize")
  @HttpCode(200)
  categorize(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.categorize(user.workspaceId, categorizeBody.parse(body));
  }

  @Post("accept-suggestion")
  @HttpCode(200)
  accept(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.acceptSuggestion(user.workspaceId, idsBody.parse(body).transactionIds);
  }

  @Post("mark-transfer")
  @HttpCode(200)
  mark(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const b = markBody.parse(body);
    return this.service.markTransfer(user.workspaceId, b.transactionId, b.counterpartTransactionId);
  }

  @Post("unpair")
  @HttpCode(200)
  unpair(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.unpair(user.workspaceId, unpairBody.parse(body).transferPairId);
  }

  @Post("ignore")
  @HttpCode(200)
  ignore(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.ignore(user.workspaceId, idsBody.parse(body).transactionIds);
  }

  @Post("recategorize")
  @HttpCode(201)
  recategorize(@CurrentUser() user: AuthenticatedUser) {
    return this.service.recategorize(user.workspaceId, user.id);
  }

  @Get("transfer-candidates")
  candidates(@CurrentUser() user: AuthenticatedUser, @Query("transactionId") transactionId?: string) {
    return this.service.transferCandidates(user.workspaceId, transactionId ?? "");
  }
}
```

Criar `apps/api/src/review/review.module.ts` (ler antes `transactions.module.ts` e `category-rules.module.ts` para confirmar que exportam `TransactionsService` e `CategoryRulesService`; se não exportarem, acrescentar o `exports` correspondente):

```ts
import { Module } from "@nestjs/common";
import { CategoryRulesModule } from "../category-rules/category-rules.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { ReviewController } from "./review.controller";
import { ReviewService } from "./review.service";

@Module({
  imports: [TransactionsModule, CategoryRulesModule],
  controllers: [ReviewController],
  providers: [ReviewService],
})
export class ReviewModule {}
```

Em `apps/api/src/app.module.ts`, importar `ReviewModule` e acrescentá-lo à lista `imports`.

- [ ] **Step 6: `PATCH /transactions/:id/category`, `hitCount` nas regras**

Em `apps/api/src/transactions/transactions.service.ts`, acrescentar aos imports:

```ts
import { categoryFits, type AccountEntity } from "@app/shared";
import { findSimilarUncategorizedIds } from "../common/similar-transactions";
```

(mesclando com o import existente de `@app/shared`) e substituir o método `updateCategory` inteiro por:

```ts
  async updateCategory(workspaceId: string, id: string, categoryId: string | null, applyToSimilar = false) {
    const tx = await prisma.transaction.findFirst({
      where: { id, workspaceId },
      select: { id: true, type: true, counterparty: true, description: true, account: { select: { entity: true } } },
    });
    if (!tx) throw new NotFoundException("transação não encontrada");

    if (categoryId === null) {
      await prisma.transaction.update({
        where: { id },
        data: { categoryId: null, categorySource: "none", categoryConfidence: null, suggestedCategoryId: null },
      });
      return { id, categoryId: null, similarCount: 0 };
    }

    const category = await prisma.category.findFirst({
      where: { id: categoryId, workspaceId },
      select: { id: true, type: true, entity: true },
    });
    if (!category) throw new BadRequestException("categoria inexistente");
    if (!categoryFits(category, tx, (tx.account?.entity ?? null) as AccountEntity | null)) {
      throw new BadRequestException("a categoria não serve ao lançamento (tipo ou entidade)");
    }

    const similar = applyToSimilar ? await findSimilarUncategorizedIds(workspaceId, [tx], category) : [];
    await prisma.transaction.updateMany({
      where: { id: { in: [id, ...similar] }, workspaceId },
      data: { categoryId, categorySource: "manual", categoryConfidence: null, reviewStatus: "ok", suggestedCategoryId: null },
    });

    if (this.rules) {
      await this.rules.learnFromCorrection({ counterparty: tx.counterparty, description: tx.description }, categoryId, workspaceId);
    }
    return { id, categoryId, similarCount: similar.length };
  }
```

Em `apps/api/src/transactions/transactions.controller.ts`, substituir o método `updateCategory` por:

```ts
  @Patch(":id/category")
  @HttpCode(200)
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() body: { categoryId: string | null; applyToSimilar?: boolean },
  ) {
    return this.service.updateCategory(user.workspaceId, id, body.categoryId, body.applyToSimilar === true);
  }
```

Em `apps/api/src/category-rules/category-rules.service.ts`, no `select` do método `list`, acrescentar `hitCount: true`.

- [ ] **Step 7: Rodar os testes e o typecheck**

```bash
pnpm --filter @app/api exec vitest run test/e2e/revisao.e2e.test.ts
pnpm --filter @app/api typecheck
pnpm --filter @app/api test
```

Esperado: todos os testes novos passam e a suíte completa da API continua verde. Se algum teste antigo falhar porque faz `PATCH /transactions/:id/category` com categoria de tipo diferente do lançamento (agora 400), ajustar o teste para usar uma categoria compatível e listar o ajuste no relatório.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
feat(api): fila de revisão (categorizar grupo, aceitar sugestão, transferências, ignorar) e categorização manual com lançamentos parecidos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: API — integridade da importação, origem da categoria e seguimentos das fases 10 e 11

**Files:**
- Modify: `apps/api/src/transactions/transactions.service.ts` (`create`)
- Modify: `apps/api/src/import/import.service.ts` (`commit`)
- Modify: `apps/api/src/import/import-statement.service.ts` (`undo`)
- Modify: `apps/api/src/workspaces/workspace-settings.service.ts` (`get`)
- Modify: `packages/shared/src/parsers/ofx-statement.ts`
- Create: `apps/api/test/e2e/integridade-importacao.e2e.test.ts`
- Modify: `packages/shared/src/__tests__/statement-parsers.test.ts`, `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`

**Interfaces:**
- Consumes (Task 1): campos novos do Prisma.
- Produces:
  - `TransactionsService.create` grava `categorySource = "manual"` quando há `categoryId` (e `none` quando não há); `ImportService.commit` grava `"import"` para linhas que trazem `categoryId` (e `none` nas demais).
  - `ImportService.commit` valida que todo `categoryId` das linhas pertence ao workspace (400) e vira transacional: o status do lote muda com um `updateMany` condicional (`undoneAt: null`) na mesma transação do `createMany`.
  - `ImportStatementService.undo` também solta o par (`transferPairId = null`, `reviewStatus = pending`) das contrapartes que não são do lote.
  - `GET /workspaces/current/settings` lê sem escrever: devolve os padrões se a linha não existe.
  - Um OFX com `DTPOSTED` ou `TRNAMT` inválido lança `StatementParseError` (422 no preview).

- [ ] **Step 1: Escrever os testes (devem falhar)**

Em `packages/shared/src/__tests__/statement-parsers.test.ts`, dentro do `describe("ofxStatementParser", …)`, acrescentar:

```ts
  it("lança StatementParseError quando uma transação não tem data ou valor válidos", () => {
    const semData = "<OFX><BANKTRANLIST><STMTTRN><TRNAMT>-10.00<FITID>1<MEMO>x</STMTTRN></BANKTRANLIST></OFX>";
    const semValor = "<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260605<FITID>1<MEMO>x</STMTTRN></BANKTRANLIST></OFX>";
    const dataImpossivel = "<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20261345<TRNAMT>-10.00<FITID>1<MEMO>x</STMTTRN></BANKTRANLIST></OFX>";
    for (const text of [semData, semValor, dataImpossivel]) {
      expect(() => ofxStatementParser.parse(text, { accountId: "a" })).toThrow(StatementParseError);
    }
  });
```

Criar `apps/api/test/e2e/integridade-importacao.e2e.test.ts`:

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
type User = Awaited<ReturnType<typeof newUser>>;

const post = (u: User, url: string, payload: unknown = {}) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });
const account = (u: User, name = "Conta") => prisma.bankAccount.create({ data: { workspaceId: u.workspaceId, type: "checking", name } });
const category = (u: User, name: string, type: "income" | "expense" = "expense") =>
  prisma.category.create({ data: { workspaceId: u.workspaceId, name, type } });

function batch(u: User, accountId: string, data: Record<string, unknown> = {}) {
  return prisma.importBatch.create({
    data: { workspaceId: u.workspaceId, accountId, format: "csv", status: "preview", createdById: u.userId, ...data } as never,
    select: { id: true },
  });
}

const row = (accountId: string, fp: string, extra: Record<string, unknown> = {}) => ({
  type: "expense", amountCents: 1000, date: "2026-06-10", accountId, description: "x", fingerprint: fp, ...extra,
});

describe("categorySource nas gravações", () => {
  it("lançamento manual com categoria é manual; sem categoria é none", async () => {
    const u = await newUser("src1");
    const acc = await account(u);
    const cat = await category(u, "Lazer");
    const com = await post(u, "/transactions", { type: "expense", amountCents: 100, date: "2026-06-01", accountId: acc.id, categoryId: cat.id });
    const sem = await post(u, "/transactions", { type: "expense", amountCents: 100, date: "2026-06-01", accountId: acc.id });
    expect(com.statusCode).toBe(201);
    const find = (id: string) => prisma.transaction.findUniqueOrThrow({ where: { id } });
    expect((await find(com.json().id)).categorySource).toBe("manual");
    expect((await find(sem.json().id)).categorySource).toBe("none");
  });

  it("importação: linha com categoryId é import; sem categoria é none", async () => {
    const u = await newUser("src2");
    const acc = await account(u);
    const cat = await category(u, "Mercado");
    const b = await batch(u, acc.id);
    const res = await post(u, `/import/${b.id}/commit`, {
      rows: [row(acc.id, "a", { categoryId: cat.id }), row(acc.id, "b")],
    });
    expect(res.json()).toEqual({ inserted: 2, skipped: 0 });
    const txs = await prisma.transaction.findMany({ where: { workspaceId: u.workspaceId }, orderBy: { importFingerprint: "asc" } });
    expect(txs.map((t) => t.categorySource)).toEqual(["import", "none"]);
  });

  it("rascunho confirmado com categoria vira manual", async () => {
    const u = await newUser("src3");
    const acc = await account(u);
    const cat = await category(u, "Saúde");
    const job = await prisma.aiJob.create({ data: { workspaceId: u.workspaceId, kind: "parse_text", createdById: u.userId } });
    const draft = await prisma.transactionDraft.create({
      data: {
        workspaceId: u.workspaceId, aiJobId: job.id, kind: "parse_text", type: "expense", amountCents: 500n,
        date: new Date("2026-06-02"), description: "Farmácia", categoryId: cat.id, createdById: u.userId,
      } as never,
    });
    const res = await post(u, `/drafts/${draft.id}/confirm`, { accountId: acc.id });
    expect(res.statusCode).toBe(201);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: res.json().id } })).categorySource).toBe("manual");
  });
});

describe("commit da importação", () => {
  it("recusa categoryId de outro workspace (400) sem gravar nada", async () => {
    const a = await newUser("com1a");
    const b = await newUser("com1b");
    const acc = await account(a);
    const alheia = await category(b, "Alheia");
    const bt = await batch(a, acc.id);
    const res = await post(a, `/import/${bt.id}/commit`, { rows: [row(acc.id, "a", { categoryId: alheia.id })] });
    expect(res.statusCode).toBe(400);
    expect(await prisma.transaction.count({ where: { workspaceId: a.workspaceId } })).toBe(0);
  });

  it("commit e desfazer simultâneos nunca deixam linhas num lote desfeito", async () => {
    for (let i = 0; i < 8; i++) {
      const u = await newUser(`race${i}`);
      const acc = await account(u);
      const b = await batch(u, acc.id, { status: "committed" });
      await prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", amountCents: 1n, date: new Date("2026-06-01"), accountId: acc.id, source: "import", createdById: u.userId, importBatchId: b.id, importFingerprint: `seed-${i}` },
      });
      await Promise.all([
        post(u, `/import/${b.id}/undo`),
        post(u, `/import/${b.id}/commit`, { rows: [row(acc.id, `new-${i}`)] }),
      ]);
      const after = await prisma.importBatch.findUniqueOrThrow({ where: { id: b.id } });
      const count = await prisma.transaction.count({ where: { importBatchId: b.id } });
      if (after.undoneAt) expect(count).toBe(0);
    }
  });
});

describe("desfazer lote e pares de transferência", () => {
  it("solta o par das contrapartes que não são do lote", async () => {
    const u = await newUser("undo1");
    const pj = await account(u, "PJ");
    const pf = await account(u, "PF");
    const b = await batch(u, pj.id, { status: "committed" });
    const make = (accountId: string, extra: Record<string, unknown>) =>
      prisma.transaction.create({
        data: { workspaceId: u.workspaceId, type: "expense", amountCents: 5000n, date: new Date("2026-06-10"), accountId, source: "import", createdById: u.userId, transferPairId: "par-1", reviewStatus: "ok", ...extra } as never,
      });
    await make(pj.id, { importBatchId: b.id, importFingerprint: "in-batch" });
    const fora = await make(pf.id, { type: "income", importFingerprint: "outside" });

    const res = await post(u, `/import/${b.id}/undo`);
    expect(res.json()).toEqual({ removed: 1 });
    expect(await prisma.transaction.findUniqueOrThrow({ where: { id: fora.id } })).toMatchObject({
      transferPairId: null, reviewStatus: "pending", categorySource: "none",
    });
  });
});

describe("OFX malformado e settings", () => {
  it("preview de OFX sem data válida retorna 422", async () => {
    const u = await newUser("ofx1");
    const acc = await account(u);
    const ofx = "<OFX><BANKACCTFROM><ACCTID>1</BANKACCTFROM><BANKTRANLIST><STMTTRN><TRNAMT>-10.00<FITID>1<MEMO>x</STMTTRN></BANKTRANLIST></OFX>";
    const res = await post(u, "/import/preview", { accountId: acc.id, text: ofx, format: "ofx" });
    expect(res.statusCode).toBe(422);
  });

  it("GET /workspaces/current/settings não cria linha; PATCH cria", async () => {
    const u = await newUser("set1");
    const get = () => app.inject({ method: "GET", url: "/workspaces/current/settings", headers: u.h });
    expect((await get()).json()).toEqual({ aiConfidenceThreshold: 0.8, aiBatchSize: 40, transferMatchWindowDays: 2, ownerNames: [] });
    expect(await prisma.workspaceSettings.count({ where: { workspaceId: u.workspaceId } })).toBe(0);

    await app.inject({ method: "PATCH", url: "/workspaces/current/settings", headers: u.h, payload: { aiBatchSize: 10 } });
    expect(await prisma.workspaceSettings.count({ where: { workspaceId: u.workspaceId } })).toBe(1);
    expect((await get()).json().aiBatchSize).toBe(10);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/shared test
pnpm --filter @app/api exec vitest run test/e2e/integridade-importacao.e2e.test.ts
```

Esperado: FAIL no teste novo do OFX (shared) e em vários do e2e (categorySource `none`, commit aceitando categoria alheia, par não solto, settings criando linha, OFX sem data passando). O teste de corrida pode passar mesmo antes da correção (ele só falha quando o intervalo de concorrência ocorre); isso é esperado.

- [ ] **Step 3: Implementar (shared e API)**

Em `packages/shared/src/parsers/ofx-statement.ts`, adicionar `toISODate` ao import de `./text` (`import { toISODate } from "./text";`) e, logo depois de `const txns = parseOfx(text);` e da checagem de lista vazia, acrescentar:

```ts
    txns.forEach((t, i) => {
      const [y, m, d] = t.dateISO.split("-").map(Number);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(t.dateISO) || !toISODate(y, m, d) || !Number.isFinite(t.amountCents)) {
        throw new StatementParseError(`transação ${i + 1} do OFX sem data ou valor válidos`);
      }
    });
```

Em `apps/api/src/transactions/transactions.service.ts`, no método `create`, acrescentar ao objeto `data` do `prisma.transaction.create`, depois de `source: "manual",`:

```ts
        categorySource: dto.categoryId ? "manual" : "none",
```

Em `apps/api/src/import/import.service.ts`, no método `commit`:

1. Depois da validação das contas, acrescentar a validação das categorias:

```ts
    const categoryIds = [...new Set(rows.map((r) => r.categoryId).filter((c): c is string => !!c))];
    if (categoryIds.length) {
      const ownedCats = await prisma.category.count({ where: { id: { in: categoryIds }, workspaceId } });
      if (ownedCats !== categoryIds.length) throw new BadRequestException("categoria inexistente no workspace");
    }
```

2. No `payload`, acrescentar em cada linha `categorySource: r.categoryId ? ("import" as const) : ("none" as const),`.

3. Substituir as duas chamadas separadas (`createMany` e `importBatch.update`) por uma transação interativa. Trocar o trecho

```ts
    const { count: inserted } = await prisma.transaction.createMany({ data: payload, skipDuplicates: true });

    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: "committed" },
    });
```

por:

```ts
    const inserted = await prisma.$transaction(async (tx) => {
      // a troca condicional de status serializa o commit com um desfazer concorrente
      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, workspaceId, undoneAt: null },
        data: { status: "committed" },
      });
      if (claimed.count === 0) throw new ConflictException("o lote foi desfeito; gere um novo preview");
      const { count } = await tx.transaction.createMany({ data: payload, skipDuplicates: true });
      return count;
    });
```

(`ConflictException` já está importado nesse arquivo desde a fase 11; se não estiver, acrescentá-lo ao import de `@nestjs/common`.)

Em `apps/api/src/import/import-statement.service.ts`, no método `undo`, dentro da transação interativa, **antes** do `deleteMany` das transações do lote, acrescentar:

```ts
      const pairs = await tx.transaction.findMany({
        where: { workspaceId, importBatchId: batchId, transferPairId: { not: null } },
        select: { transferPairId: true },
      });
      const pairIds = [...new Set(pairs.map((p) => p.transferPairId!))];
      if (pairIds.length) {
        await tx.transaction.updateMany({
          where: { workspaceId, transferPairId: { in: pairIds }, OR: [{ importBatchId: null }, { importBatchId: { not: batchId } }] },
          data: { transferPairId: null, reviewStatus: "pending", categorySource: "none" },
        });
      }
```

Em `apps/api/src/workspaces/workspace-settings.service.ts`, substituir o método `get` por:

```ts
  /** Lê sem escrever: sem linha, devolve os padrões. */
  async get(workspaceId: string) {
    const row = await prisma.workspaceSettings.findUnique({ where: { workspaceId }, select: SETTINGS_SELECT });
    return row ?? { ...DEFAULT_WORKSPACE_SETTINGS };
  }
```

e acrescentar `import { DEFAULT_WORKSPACE_SETTINGS, type WorkspaceSettingsInput } from "@app/shared";` (substituindo o import atual de `WorkspaceSettingsInput`).

Em `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`, substituir o teste `"GET devolve os padrões da spec na primeira leitura"` por uma versão que também confere que não houve escrita (se o teste de settings da fase 10 esperava a linha criada na leitura, ajustar só essa expectativa).

- [ ] **Step 4: Rodar os testes e o typecheck**

```bash
pnpm --filter @app/shared test
pnpm --filter @app/api exec vitest run test/e2e/integridade-importacao.e2e.test.ts test/e2e/import-statements.e2e.test.ts test/e2e/modelo-pf-pj.e2e.test.ts
pnpm turbo typecheck
pnpm --filter @app/api test
```

Esperado: tudo verde. O teste `TM2` (recommit do mesmo lote idempotente) continua passando (o status `committed` ainda aceita novo commit; só `undoneAt != null` dá 409).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix(api): commit transacional, categoria validada, categorySource nas gravações, pares soltos ao desfazer, settings sem escrita e OFX malformado rejeitado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Receita e despesa ignoram transferências pareadas e lançamentos ignorados

**Files:**
- Create: `apps/api/src/common/reportable.ts`
- Modify: `apps/api/src/dashboard/dashboard.service.ts`, `apps/api/src/chat/tools.ts`, `apps/api/src/budgets/budgets.service.ts`
- Create: `apps/worker/src/insights/reportable.ts`
- Modify: `apps/worker/src/insights/compute.processor.ts`, `apps/worker/src/insights/cashflow.processor.ts`
- Create: `apps/api/test/e2e/agregacao.e2e.test.ts`, `apps/worker/test/reportable.test.ts`

**Interfaces:**
- Produces: `REPORTABLE` (`{ transferPairId: null, ignored: false }`, filtro Prisma) e `reportableSql(alias?: string)` (fragmento `Prisma.sql` com `AND <alias.>"transferPairId" IS NULL AND <alias.>"ignored" = false`) em `apps/api/src/common/reportable.ts`, e o mesmo `reportableSql` em `apps/worker/src/insights/reportable.ts` (cliente Prisma do worker).
- Regra: dashboard (fluxo do mês, quebra por categoria, série), ferramentas do chat de receita/despesa, progresso de orçamentos e os insights/previsão do worker ignoram pareados e ignorados. `BalancesService` e `get_balance` **não mudam**.

- [ ] **Step 1: Escrever os testes (devem falhar)**

Criar `apps/api/test/e2e/agregacao.e2e.test.ts`:

```ts
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { TOOLS } from "../../src/chat/tools";

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

const MONTH = new Date().toISOString().slice(0, 7);
const DAY = new Date(`${MONTH}-10T00:00:00Z`);

async function seed(tag: string) {
  const email = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.com`;
  const u = await auth.api.signUpEmail({ body: { email, password: "senha123!", name: tag } });
  const ws = await prisma.workspace.findFirstOrThrow({ where: { createdById: u!.user.id } });
  const acc = await prisma.bankAccount.create({ data: { workspaceId: ws.id, type: "checking", name: "Conta", openingBalanceCents: 0n } });
  const cat = await prisma.category.create({ data: { workspaceId: ws.id, type: "expense", name: "Mercado agr" } });
  const make = (data: Record<string, unknown>) =>
    prisma.transaction.create({
      data: { workspaceId: ws.id, accountId: acc.id, date: DAY, source: "manual", createdById: u!.user.id, ...data } as never,
    });

  await make({ type: "expense", amountCents: 1000n, categoryId: cat.id });                       // conta
  await make({ type: "income", amountCents: 2000n });                                            // conta
  await make({ type: "expense", amountCents: 500n, categoryId: cat.id, transferPairId: "p1" });  // par: fora
  await make({ type: "income", amountCents: 700n, transferPairId: "p1" });                       // par: fora
  await make({ type: "expense", amountCents: 300n, categoryId: cat.id, ignored: true });         // ignorado: fora
  return { ws, u: u!, acc, cat, h: { authorization: `Bearer ${u!.token}` } };
}

describe("receita e despesa ignoram pareados e ignorados", () => {
  it("dashboard: fluxo do mês, quebra por categoria e série", async () => {
    const { h } = await seed("agr1");
    const res = await app.inject({ method: "GET", url: `/dashboard?month=${MONTH}`, headers: h });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cashflow).toEqual({ incomeCents: 2000, expenseCents: 1000 });
    expect(body.expenseBreakdown).toEqual([expect.objectContaining({ totalCents: 1000 })]);
    const current = body.cashflowSeries.find((s: { month: string }) => s.month === MONTH);
    expect(current).toMatchObject({ incomeCents: 2000, expenseCents: 1000 });
  });

  it("chat: get_cashflow, get_category_spending e get_cashflow_series", async () => {
    const { ws } = await seed("agr2");
    const ctx = { workspaceId: ws.id };
    expect(await TOOLS.get_cashflow.run({ month: MONTH }, ctx)).toMatchObject({ incomeCents: 2000, expenseCents: 1000 });
    const spending = (await TOOLS.get_category_spending.run({ month: MONTH, type: "expense" }, ctx)) as Array<{ totalCents: number }>;
    expect(spending.map((s) => s.totalCents)).toEqual([1000]);
    const series = (await TOOLS.get_cashflow_series.run({ months: 1 }, ctx)) as Array<{ incomeCents: number; expenseCents: number }>;
    expect(series[0]).toMatchObject({ incomeCents: 2000, expenseCents: 1000 });
  });

  it("orçamentos: o progresso não conta pareados nem ignorados", async () => {
    const { ws, h, cat } = await seed("agr3");
    const created = await app.inject({
      method: "POST", url: "/budgets", headers: { ...h, "content-type": "application/json" },
      payload: { categoryId: cat.id, method: "fixed", limitCents: 10000 },
    });
    expect([200, 201]).toContain(created.statusCode);
    const list = await app.inject({ method: "GET", url: "/budgets", headers: h });
    const b = (list.json() as Array<{ categoryId: string | null; spentCents: number }>).find((x) => x.categoryId === cat.id);
    expect(b?.spentCents).toBe(1000);
    expect(ws.id).toBeTruthy();
  });

  it("o saldo por conta continua contando todos os movimentos", async () => {
    const { h } = await seed("agr4");
    const res = await app.inject({ method: "GET", url: "/balances", headers: h });
    // 2000 + 700 (receitas) − 1000 − 500 − 300 (despesas) = 900
    expect(res.json().consolidatedCents).toBe(900);
  });
});
```

Se o formato do `POST /budgets` ou do `GET /budgets` do projeto diferir do usado acima, ler `apps/api/src/budgets/budgets.controller.ts` e o teste existente em `apps/api/test/e2e/intelligence.e2e.test.ts` e ajustar só o payload e o nome do campo de gasto, mantendo a expectativa (gasto do orçamento = 1000).

Criar `apps/worker/test/reportable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reportableSql } from "../src/insights/reportable";

describe("reportableSql", () => {
  it("exclui pareados e ignorados, com e sem alias de tabela", () => {
    expect(reportableSql().sql.replace(/\s+/g, " ")).toBe('AND "transferPairId" IS NULL AND "ignored" = false');
    expect(reportableSql("t").sql.replace(/\s+/g, " ")).toBe('AND t."transferPairId" IS NULL AND t."ignored" = false');
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/agregacao.e2e.test.ts
pnpm --filter @app/worker exec vitest run test/reportable.test.ts
```

Esperado: FAIL (os totais incluem pareados e ignorados; módulo `reportable` do worker inexistente). O teste de saldo já passa.

- [ ] **Step 3: Implementar**

Criar `apps/api/src/common/reportable.ts`:

```ts
import { Prisma } from "../../generated/prisma/client";

/** Filtro Prisma dos lançamentos que entram em receita/despesa: fora transferências pareadas e ignorados. */
export const REPORTABLE = { transferPairId: null, ignored: false } as const;

/** O mesmo filtro como fragmento de SQL; `alias` é o alias da tabela `transactions` na consulta (se houver). */
export function reportableSql(alias?: string) {
  const col = (name: string) => Prisma.raw(alias ? `${alias}."${name}"` : `"${name}"`);
  return Prisma.sql`AND ${col("transferPairId")} IS NULL AND ${col("ignored")} = false`;
}
```

Criar `apps/worker/src/insights/reportable.ts` com o **mesmo conteúdo**, trocando o import para `import { Prisma } from "../../generated/prisma/client";` (o cliente gerado do worker; o caminho relativo de `src/insights/` até `generated/` é `../../generated/prisma/client`) e removendo a constante `REPORTABLE`.

Aplicar o filtro:
- `apps/api/src/dashboard/dashboard.service.ts`: importar `REPORTABLE` e acrescentar `...REPORTABLE` ao `where` das consultas de `monthCashflow` (`findMany`) e de `categoryBreakdown` (`groupBy`).
- `apps/api/src/chat/tools.ts`: acrescentar `...REPORTABLE` ao `where` de `get_cashflow`, de `get_category_spending` e de qualquer outra consulta de receita/despesa por mês (ler `get_cashflow_series`: se ela chamar outra função, o filtro vem dela; se tiver consulta própria, aplicar). **Não** alterar `get_balance` nem `search_transactions`.
- `apps/api/src/budgets/budgets.service.ts`: importar `reportableSql` e acrescentar `${reportableSql()}` depois da cláusula `AND "date" >= DATE_TRUNC('month', NOW())` do `$queryRaw`.
- `apps/worker/src/insights/compute.processor.ts`: importar `reportableSql` e acrescentar `${reportableSql("t")}` (nas consultas com alias `t`) ou `${reportableSql()}` (sem alias) ao `WHERE` das **três** consultas (`detectSpikes`, a de assinaturas e a de `spends`); ler cada uma para usar o alias certo.
- `apps/worker/src/insights/cashflow.processor.ts`: idem na consulta de `MonthRow`.

```bash
pnpm --filter @app/api exec vitest run test/e2e/agregacao.e2e.test.ts
pnpm --filter @app/worker test
pnpm turbo typecheck
pnpm --filter @app/api test
```

Esperado: os 4 testes novos da API e o do worker passam; suítes completas verdes. Se um teste antigo de dashboard/chat/orçamento quebrar, verificar se ele cria transações com `transferPairId`/`ignored` (não deveria); ajustar só se a expectativa antiga contrariar a regra nova.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat: receita e despesa (dashboard, chat, orçamentos, insights) ignoram transferências pareadas e lançamentos ignorados

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Front — tela "Para categorizar" (pendentes, transferências, rascunhos e regras)

**Files:**
- Create: `apps/web/src/lib/review-client.ts`, `apps/web/src/lib/__tests__/review-client.test.ts`
- Modify (reescrever): `apps/web/src/views/ReviewView.vue`
- Create: `apps/web/src/components/RulesPanel.vue`
- Modify: `apps/web/src/App.vue` (rótulo da aba)

**Interfaces:**
- Consumes: contrato da API da Task 4; `categoriesForEntity`, `ENTITY_LABEL`, `ENTITY_SHORT`, `accountsForEntity`, tipos em `lib/entity.ts`; `useFinanceStore` (`accounts`, `categories`, `loadAccounts`, `loadCategories`); `http` de `lib/http.ts`.
- Produces (`lib/review-client.ts`): tipos `PendingGroup`, `PendingResponse`, `TransferCandidate`, `RuleRow`; funções `getPending`, `categorizeGroup`, `acceptSuggestions`, `ignoreTransactions`, `markTransfer`, `getTransferCandidates`, `recategorize`, `listRules`, `deleteRule`; helper puro `categoriesForGroup(categories, group)`.

- [ ] **Step 1: Escrever os testes do cliente (devem falhar)**

Criar `apps/web/src/lib/__tests__/review-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http", () => ({ http: vi.fn(async () => ({})) }));

import { http } from "../http";
import {
  getPending, categorizeGroup, acceptSuggestions, ignoreTransactions, markTransfer,
  getTransferCandidates, recategorize, listRules, deleteRule, categoriesForGroup,
} from "../review-client";

const last = () => {
  const calls = vi.mocked(http).mock.calls;
  return (calls[calls.length - 1] ?? []).slice(0, 3);
};

beforeEach(() => vi.mocked(http).mockClear());

describe("chamadas à API de revisão", () => {
  it("getPending monta a query só com os filtros informados", async () => {
    await getPending({});
    expect(last()).toEqual(["GET", "/review/pending", undefined]);
    await getPending({ entity: "pj", accountId: "a1" });
    expect(last()[1]).toBe("/review/pending?entity=pj&accountId=a1");
  });

  it("categorizeGroup envia createRule/applyToSimilar", async () => {
    await categorizeGroup({ transactionIds: ["t1"], categoryId: "c1", createRule: false, applyToSimilar: true });
    expect(last()).toEqual(["POST", "/review/categorize", { transactionIds: ["t1"], categoryId: "c1", createRule: false, applyToSimilar: true }]);
  });

  it("aceitar, ignorar, marcar transferência, candidatos e recategorizar", async () => {
    await acceptSuggestions(["t1"]);
    expect(last()).toEqual(["POST", "/review/accept-suggestion", { transactionIds: ["t1"] }]);
    await ignoreTransactions(["t1", "t2"]);
    expect(last()).toEqual(["POST", "/review/ignore", { transactionIds: ["t1", "t2"] }]);
    await markTransfer("t1", "t2");
    expect(last()).toEqual(["POST", "/review/mark-transfer", { transactionId: "t1", counterpartTransactionId: "t2" }]);
    await getTransferCandidates("t1");
    expect(last()[1]).toBe("/review/transfer-candidates?transactionId=t1");
    await recategorize();
    expect(last()).toEqual(["POST", "/review/recategorize", {}]);
  });

  it("regras: listar e excluir", async () => {
    await listRules();
    expect(last()[1]).toBe("/category-rules");
    await deleteRule("r1");
    expect(last()).toEqual(["DELETE", "/category-rules/r1", undefined]);
  });
});

describe("categoriesForGroup", () => {
  const cats = [
    { id: "a", type: "expense" as const, entity: "both" as const, name: "A" },
    { id: "b", type: "expense" as const, entity: "pj" as const, name: "B" },
    { id: "c", type: "income" as const, entity: "both" as const, name: "C" },
    { id: "d", type: "expense" as const, entity: "pf" as const, name: "D" },
  ];

  it("filtra por tipo do grupo e, quando o grupo tem entidade, pela entidade", () => {
    expect(categoriesForGroup(cats, { type: "expense", entity: "pj" }).map((c) => c.id)).toEqual(["a", "b"]);
    expect(categoriesForGroup(cats, { type: "expense", entity: "pf" }).map((c) => c.id)).toEqual(["a", "d"]);
    expect(categoriesForGroup(cats, { type: "income", entity: null }).map((c) => c.id)).toEqual(["c"]);
  });

  it("grupo de entidade mista ou sem conta mostra todas as categorias do tipo", () => {
    expect(categoriesForGroup(cats, { type: "expense", entity: null }).map((c) => c.id)).toEqual(["a", "b", "d"]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/web test
```

Esperado: FAIL (módulo `../review-client` inexistente).

- [ ] **Step 3: Criar `lib/review-client.ts`**

```ts
import { http } from "./http";
import { categoriesForEntity, type AccountEntity, type CategoryEntity } from "./entity";

export interface PendingGroup {
  key: string;
  type: "income" | "expense";
  description: string;
  count: number;
  totalCents: number;
  entity: AccountEntity | null;
  suggestedCategoryId: string | null;
  transactionIds: string[];
}

export interface PendingResponse {
  total: number;
  groups: PendingGroup[];
}

export interface TransferCandidate {
  id: string;
  date: string;
  amountCents: number;
  description: string | null;
  accountName: string | null;
}

export interface RuleRow {
  id: string;
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  categoryId: string;
  priority: number;
  hitCount: number;
}

export function getPending(params: { entity?: AccountEntity; accountId?: string }) {
  const qs = new URLSearchParams();
  if (params.entity) qs.set("entity", params.entity);
  if (params.accountId) qs.set("accountId", params.accountId);
  const s = qs.toString();
  return http<PendingResponse>("GET", `/review/pending${s ? `?${s}` : ""}`);
}

export function categorizeGroup(body: { transactionIds: string[]; categoryId: string; createRule?: boolean; applyToSimilar?: boolean }) {
  return http<{ updated: number; similarUpdated: number; ruleCreated: boolean }>("POST", "/review/categorize", body);
}

export function acceptSuggestions(transactionIds: string[]) {
  return http<{ accepted: number; skipped: number }>("POST", "/review/accept-suggestion", { transactionIds });
}

export function ignoreTransactions(transactionIds: string[]) {
  return http<{ ignored: number }>("POST", "/review/ignore", { transactionIds });
}

export function markTransfer(transactionId: string, counterpartTransactionId: string) {
  return http<{ transferPairId: string }>("POST", "/review/mark-transfer", { transactionId, counterpartTransactionId });
}

export function getTransferCandidates(transactionId: string) {
  return http<TransferCandidate[]>("GET", `/review/transfer-candidates?transactionId=${encodeURIComponent(transactionId)}`);
}

export function recategorize() {
  return http<{ id: string }>("POST", "/review/recategorize", {});
}

export function listRules() {
  return http<RuleRow[]>("GET", "/category-rules");
}

export function deleteRule(id: string) {
  return http<void>("DELETE", `/category-rules/${id}`);
}

/** Categorias oferecidas a um grupo: do tipo do grupo e, se o grupo é de uma só entidade, compatíveis com ela. */
export function categoriesForGroup<T extends { type: "income" | "expense"; entity: CategoryEntity }>(
  categories: T[],
  group: { type: "income" | "expense"; entity: AccountEntity | null },
): T[] {
  return categoriesForEntity(categories.filter((c) => c.type === group.type), group.entity);
}
```

```bash
pnpm --filter @app/web test
pnpm --filter @app/web typecheck
```

Esperado: os testes novos passam (45 anteriores + 7) e typecheck verde.

- [ ] **Step 4: Painel de regras**

Criar `apps/web/src/components/RulesPanel.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useFinanceStore } from "../stores/finance";
import { deleteRule, listRules, type RuleRow } from "../lib/review-client";

const finance = useFinanceStore();
const rules = ref<RuleRow[]>([]);
const erro = ref("");

const MATCH_LABEL: Record<RuleRow["matchType"], string> = { contains: "contém", equals: "igual a", regex: "regex" };

async function load() {
  erro.value = "";
  try {
    rules.value = await listRules();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

onMounted(async () => {
  await Promise.all([finance.loadCategories(), load()]);
});

function categoryName(id: string) {
  return finance.categories.find((c) => c.id === id)?.name ?? "—";
}

async function remove(id: string) {
  if (!window.confirm("Excluir esta regra?")) return;
  try {
    await deleteRule(id);
    await load();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="rules">
    <h3>Regras de categorização</h3>
    <p v-if="erro" role="alert" class="error">{{ erro }}</p>
    <p v-if="!rules.length" class="hint">Nenhuma regra ainda. Elas nascem quando você categoriza um grupo.</p>
    <table v-else class="rules-table">
      <thead>
        <tr><th>Padrão</th><th>Casamento</th><th>Categoria</th><th>Prioridade</th><th>Acertos</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rules" :key="r.id">
          <td>{{ r.pattern }}</td>
          <td>{{ MATCH_LABEL[r.matchType] }}</td>
          <td>{{ categoryName(r.categoryId) }}</td>
          <td>{{ r.priority }}</td>
          <td>{{ r.hitCount }}</td>
          <td><button type="button" class="btn-danger" @click="remove(r.id)">Excluir</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rules { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
h3 { margin: 0; font-size: 1rem; }
.hint { font-size: 0.85rem; opacity: 0.65; font-style: italic; }
.error { color: #e74c3c; font-size: 0.9rem; }
.rules-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.rules-table th, .rules-table td { text-align: left; padding: var(--space); border-bottom: 1px solid #222; }
.rules-table th { opacity: 0.6; font-weight: 600; }
button { padding: calc(var(--space) * 0.75) calc(var(--space) * 1.5); border: none; border-radius: calc(var(--radius) / 2); color: #fff; cursor: pointer; font-size: 0.8rem; }
.btn-danger { background: #c0392b; }
</style>
```

- [ ] **Step 5: Reescrever `ReviewView.vue`**

Ler o `ReviewView.vue` atual (rascunhos: `Draft`, `load`, `confirm`, `discard`, `formatBRL`, `formatDate`, `confidenceColor` e o template da lista) e **preservar exatamente o comportamento dos rascunhos** dentro da seção "Rascunhos". Substituir o arquivo por uma versão que mantém essas funções e acrescenta, acima dos rascunhos, a seção de pendentes. Estrutura obrigatória:

```vue
<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { http } from "../lib/http";
import { useFinanceStore } from "../stores/finance";
import { ENTITY_SHORT, accountsForEntity, type EntityFilter } from "../lib/entity";
import {
  acceptSuggestions, categorizeGroup, categoriesForGroup, getPending, getTransferCandidates,
  ignoreTransactions, markTransfer, recategorize,
  type PendingGroup, type PendingResponse, type TransferCandidate,
} from "../lib/review-client";
import RulesPanel from "../components/RulesPanel.vue";

const finance = useFinanceStore();

// ───── pendentes de categoria ─────
const pending = ref<PendingResponse>({ total: 0, groups: [] });
const entityFilter = ref<EntityFilter>("all");
const accountFilter = ref("");
const showRules = ref(false);
const erro = ref("");
const info = ref("");
const busy = ref(false);

interface GroupUi { categoryId: string; createRule: boolean; applyToSimilar: boolean; transferOpen: boolean; candidates: TransferCandidate[]; counterpartId: string }
const ui = reactive<Record<string, GroupUi>>({});

const filterAccounts = computed(() => accountsForEntity(finance.accounts, entityFilter.value));

function uiFor(g: PendingGroup): GroupUi {
  if (!ui[g.key]) {
    ui[g.key] = { categoryId: g.suggestedCategoryId ?? "", createRule: true, applyToSimilar: true, transferOpen: false, candidates: [], counterpartId: "" };
  }
  return ui[g.key];
}

async function loadPending() {
  pending.value = await getPending({
    entity: entityFilter.value === "all" ? undefined : entityFilter.value,
    accountId: accountFilter.value || undefined,
  });
}

async function run(action: () => Promise<unknown>, okMessage?: string) {
  if (busy.value) return;
  busy.value = true;
  erro.value = "";
  info.value = "";
  try {
    await action();
    if (okMessage) info.value = okMessage;
    await loadPending();
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function onEntityChange() {
  if (accountFilter.value && !filterAccounts.value.some((a) => a.id === accountFilter.value)) accountFilter.value = "";
  void run(async () => undefined);
}

const categorize = (g: PendingGroup) => {
  const s = uiFor(g);
  if (!s.categoryId) { erro.value = "Escolha uma categoria."; return; }
  return run(async () => {
    const r = await categorizeGroup({ transactionIds: g.transactionIds, categoryId: s.categoryId, createRule: s.createRule, applyToSimilar: s.applyToSimilar });
    info.value = `${r.updated} lançamento(s) categorizado(s)${r.similarUpdated ? ` (${r.similarUpdated} parecidos)` : ""}${r.ruleCreated ? " e regra criada" : ""}.`;
  });
};
const accept = (g: PendingGroup) => run(async () => { const r = await acceptSuggestions(g.transactionIds); info.value = `${r.accepted} sugestão(ões) aceita(s).`; });
const ignore = (g: PendingGroup) => run(async () => { const r = await ignoreTransactions(g.transactionIds); info.value = `${r.ignored} lançamento(s) ignorado(s).`; });
const recat = () => run(async () => { await recategorize(); info.value = "Recategorização enfileirada. Volte em instantes."; });

async function openTransfer(g: PendingGroup) {
  const s = uiFor(g);
  s.transferOpen = !s.transferOpen;
  if (s.transferOpen && g.count === 1) {
    try { s.candidates = await getTransferCandidates(g.transactionIds[0]); } catch (e) { erro.value = (e as Error).message; }
  }
}
const confirmTransfer = (g: PendingGroup) => {
  const s = uiFor(g);
  if (!s.counterpartId) { erro.value = "Escolha a contraparte."; return; }
  return run(async () => { await markTransfer(g.transactionIds[0], s.counterpartId); info.value = "Transferência marcada."; });
};

// ───── rascunhos (comportamento original) ─────
// (manter aqui, sem alterações de lógica: interface Draft, drafts, overrides, loadDrafts (antigo load),
//  confirm, discard, formatBRL, formatDate, confidenceColor)

onMounted(async () => {
  await Promise.all([finance.loadAccounts(), finance.loadCategories(), loadPending(), /* loadDrafts() */]);
});

const suggestedName = (id: string | null) => finance.categories.find((c) => c.id === id)?.name ?? null;
</script>
```

Template (o bloco de rascunhos é o template original, movido para a seção "Rascunhos"):

```vue
<template>
  <section class="review">
    <header class="head">
      <h2>Para categorizar <span class="counter">{{ pending.total }}</span></h2>
      <div class="head-actions">
        <button type="button" class="btn-secondary" :disabled="busy" @click="recat">Recategorizar pendentes</button>
        <button type="button" class="btn-secondary" @click="showRules = !showRules">{{ showRules ? "Ocultar regras" : "Regras" }}</button>
      </div>
    </header>

    <p v-if="erro" role="alert" class="error">{{ erro }}</p>
    <p v-if="info" class="info">{{ info }}</p>

    <RulesPanel v-if="showRules" />

    <div class="filters">
      <select v-model="entityFilter" aria-label="Entidade" @change="onEntityChange">
        <option value="all">PF e PJ</option>
        <option value="pf">Pessoa Física</option>
        <option value="pj">Pessoa Jurídica</option>
      </select>
      <select v-model="accountFilter" aria-label="Conta" @change="run(async () => undefined)">
        <option value="">Todas as contas</option>
        <option v-for="a in filterAccounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
      </select>
    </div>

    <p v-if="!pending.groups.length" class="empty">Nada pendente de categoria.</p>

    <ul class="groups">
      <li v-for="g in pending.groups" :key="g.key" class="group">
        <div class="group-head">
          <strong class="group-desc">{{ g.description }}</strong>
          <span class="group-meta">{{ g.count }} lançamento(s) · {{ (g.totalCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }} · {{ g.type === "income" ? "receita" : "despesa" }}<template v-if="g.entity"> · {{ ENTITY_SHORT[g.entity] }}</template></span>
        </div>
        <p v-if="suggestedName(g.suggestedCategoryId)" class="suggested">IA sugere: {{ suggestedName(g.suggestedCategoryId) }}</p>

        <div class="group-actions">
          <select v-model="uiFor(g).categoryId" :aria-label="`Categoria de ${g.description}`">
            <option value="">— Categoria —</option>
            <option v-for="c in categoriesForGroup(finance.categories, g)" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <label class="check"><input v-model="uiFor(g).createRule" type="checkbox" /> Criar regra</label>
          <label class="check"><input v-model="uiFor(g).applyToSimilar" type="checkbox" /> Aplicar a parecidos</label>
          <button type="button" :disabled="busy" @click="categorize(g)">Categorizar</button>
          <button v-if="g.suggestedCategoryId" type="button" class="btn-secondary" :disabled="busy" @click="accept(g)">Aceitar sugestão</button>
          <button v-if="g.count === 1" type="button" class="btn-secondary" :disabled="busy" @click="openTransfer(g)">Marcar transferência</button>
          <button type="button" class="btn-secondary" :disabled="busy" @click="ignore(g)">Ignorar</button>
        </div>

        <div v-if="uiFor(g).transferOpen && g.count === 1" class="transfer">
          <p v-if="!uiFor(g).candidates.length" class="hint">Nenhuma contraparte encontrada (mesmo valor, outra conta, até 7 dias).</p>
          <template v-else>
            <select v-model="uiFor(g).counterpartId" aria-label="Contraparte">
              <option value="">— Contraparte —</option>
              <option v-for="c in uiFor(g).candidates" :key="c.id" :value="c.id">
                {{ c.date.split("-").reverse().join("/") }} · {{ c.accountName }} · {{ (c.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) }} · {{ c.description ?? "—" }}
              </option>
            </select>
            <button type="button" :disabled="busy" @click="confirmTransfer(g)">Confirmar transferência</button>
          </template>
        </div>
      </li>
    </ul>

    <h2 class="drafts-title">Rascunhos</h2>
    <!-- aqui entra, sem alterações, o conteúdo original do template de rascunhos (lista, ações confirmar/descartar) -->
  </section>
</template>
```

O `<style scoped>` mantém os estilos originais dos rascunhos e acrescenta regras para `.head`, `.counter`, `.filters`, `.groups`, `.group`, `.group-head`, `.group-actions`, `.check`, `.transfer`, `.info`, `.btn-secondary`, usando os tokens CSS existentes (`--color-surface`, `--color-primary`, `--space`, `--radius`).

Em `apps/web/src/App.vue`, trocar o texto do botão `Revisar` (`<button :class="{ active: tab === 'review' }" @click="tab = 'review'">Revisar</button>`) por `Para categorizar`; a chave de aba `review` e o `SharedEntryView` (que leva a `review`) permanecem.

```bash
pnpm --filter @app/web typecheck
pnpm --filter @app/web test
```

Esperado: vue-tsc verde e todos os testes passando.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
feat(web): tela "Para categorizar" com pendentes agrupados, transferências, regras e rascunhos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verificação de ponta a ponta, documentação e integração

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-30-fase-12-categorizacao.md` (marcar os passos)

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Typecheck, testes e drift, sem cache**

```bash
docker compose up -d
pnpm exec prisma migrate deploy
pnpm turbo typecheck --force
pnpm turbo test --force
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script | grep -c "empty migration"
```

Esperado: exit 0, nenhum teste falhando e a contagem final `1`. Anotar os totais por pacote para o README.

- [ ] **Step 2: SQL dos insights do worker contra o banco real**

Os testes do worker não usam o banco, então esta verificação manual cobre o `WHERE` novo das consultas de insights. Com um workspace sintético contendo uma despesa normal, uma pareada e uma ignorada no mês corrente, rodar as funções do worker e conferir que só a normal conta. Criar e executar (sem commitar) o script `apps/worker/_verify.ts`:

```ts
import { prisma } from "./src/database";
import { computeInsights } from "./src/insights/compute.processor";

const TAG = `ver12_${Date.now()}`;
async function main() {
  const user = await prisma.user.create({ data: { id: `u_${TAG}`, name: TAG, email: `${TAG}@test.com`, emailVerified: false } });
  const ws = await prisma.workspace.create({ data: { type: "personal", name: TAG, createdById: user.id } });
  const cat = await prisma.category.create({ data: { workspaceId: ws.id, type: "expense", name: "Teste ver12" } });
  const acc = await prisma.bankAccount.create({ data: { workspaceId: ws.id, type: "checking", name: "C" } });
  const now = new Date();
  const mk = (amount: bigint, extra: Record<string, unknown>, monthOffset = 0) =>
    prisma.transaction.create({
      data: {
        workspaceId: ws.id, accountId: acc.id, categoryId: cat.id, type: "expense", amountCents: amount,
        date: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 10)), source: "manual", createdById: user.id, ...extra,
      } as never,
    });
  for (const off of [1, 2, 3]) await mk(10000n, {}, off); // histórico normal: 100,00 por mês
  await mk(10000n, {});                                   // mês atual normal: 100,00 (sem pico)
  await mk(900000n, { transferPairId: "par-x" });         // pareado: não pode gerar pico
  await mk(900000n, { ignored: true });                   // ignorado: não pode gerar pico

  await computeInsights({ workspaceId: ws.id });
  const spikes = await prisma.insight.count({ where: { workspaceId: ws.id, type: "spike" } });
  console.log("insights de pico (esperado 0):", spikes);
  await prisma.transaction.deleteMany({ where: { workspaceId: ws.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
```

```bash
cd apps/worker && pnpm exec tsx _verify.ts; rm -f _verify.ts; cd ../..
```

Esperado: `insights de pico (esperado 0): 0`. Se der `1`, o filtro não foi aplicado à consulta de picos; corrigir na Task 6. (A consulta da previsão de caixa usa a mesma função `reportableSql`; a verificação de picos cobre o mecanismo.)

- [ ] **Step 3: Fluxo completo pela API com worker, transferência e regra**

Subir os apps e simular o uso real: duas contas (PF e PJ), nomes do titular nas configurações, dois OFX sintéticos que formam uma transferência, mais um lançamento sem regra.

```bash
pnpm dev > "$TMPDIR/dev.log" 2>&1 &
sleep 30
B=http://localhost:3100; TS=$(date +%s); echo "$TS" > "$TMPDIR/f12ts"
TOKEN=$(curl -s -X POST $B/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:5173' \
  -d "{\"email\":\"f12_$TS@test.com\",\"password\":\"F12-$TS-pw!\",\"name\":\"F12\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
H=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json')
PJ=$(curl -s -X POST $B/accounts "${H[@]}" -d '{"type":"checking","name":"Empresa PJ","entity":"pj","institution":"inter","externalId":"111-1"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
PF=$(curl -s -X POST $B/accounts "${H[@]}" -d '{"type":"checking","name":"Pessoal PF","entity":"pf","institution":"inter","externalId":"222-2"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -X PATCH $B/workspaces/current/settings "${H[@]}" -d '{"ownerNames":["FULANO DE TESTE","EMPRESA TESTE LTDA"]}' > /dev/null
ofx() { printf 'OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>\n<BANKACCTFROM><BANKID>077<ACCTID>%s</BANKACCTFROM>\n<BANKTRANLIST>\n%s\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>' "$1" "$2"; }
import_ofx() { # $1=acctid $2=account $3=stmttrn-lines
  TXT=$(ofx "$1" "$3")
  python3 - "$TXT" "$2" > "$TMPDIR/pv.json" <<'E'
import sys,json
print(json.dumps({"accountId":sys.argv[2],"text":sys.argv[1],"format":"ofx"}))
E
  curl -s -X POST $B/import/preview "${H[@]}" --data @"$TMPDIR/pv.json" > "$TMPDIR/pv.out"
  python3 - "$TMPDIR/pv.out" "$2" > "$TMPDIR/cm.json" <<'E'
import sys,json
d=json.load(open(sys.argv[1]))
print(json.dumps({"rows":[{k:r.get(k) for k in ("type","amountCents","date","description","fingerprint","accountId")} for r in d["rows"]]}))
E
  BID=$(python3 -c "import json;print(json.load(open('$TMPDIR/pv.out'))['batchId'])")
  curl -s -X POST $B/import/$BID/commit "${H[@]}" --data @"$TMPDIR/cm.json"; echo
}
import_ofx 111-1 "$PJ" '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260605<TRNAMT>-100.00<FITID>P1<MEMO>Pix enviado para FULANO DE TESTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260606<TRNAMT>-42.50<FITID>P2<MEMO>Padaria do Bairro</STMTTRN>'
import_ofx 222-2 "$PF" '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260605<TRNAMT>100.00<FITID>F1<MEMO>Pix recebido de EMPRESA TESTE LTDA</STMTTRN>'
sleep 12
docker exec financas-postgres psql -U app -d financas -At -F ' | ' -c "select t.description, t.\"categorySource\", t.\"reviewStatus\", (t.\"transferPairId\" is not null) as pareado from transactions t join workspaces w on w.id=t.\"workspaceId\" join \"user\" u on u.id=w.\"createdById\" where u.email='f12_$TS@test.com' order by t.description"
docker exec financas-postgres psql -U app -d financas -At -c "select result::text from ai_jobs a join workspaces w on w.id=a.\"workspaceId\" join \"user\" u on u.id=w.\"createdById\" where u.email='f12_$TS@test.com' and kind='categorize' order by a.\"createdAt\""
rm -f "$TMPDIR"/pv.json "$TMPDIR"/pv.out "$TMPDIR"/cm.json
```

Esperado (sem chave de IA configurada, a chamada ao LLM falha e o lote fica pendente): os dois lançamentos Pix aparecem `pareado = t` com `reviewStatus ok`; "Padaria do Bairro" aparece `none | pending | f`. O job do primeiro import mostra `pending: 2` (o Pix PJ ainda não tinha contraparte) e o do segundo import mostra `transfers: 1`; ao final só a padaria segue pendente. Se houver chave de IA válida, a padaria pode aparecer categorizada por `ai` ou pendente por baixa confiança; ambos são válidos.

- [ ] **Step 4: Fluxo na interface**

Com `pnpm dev` ainda rodando, abrir `http://localhost:5173`, entrar com `f12_<ts>@test.com` (senha no comando) e abrir **Para categorizar**. Conferir, registrando cada item:

1. O cabeçalho mostra o contador (`1`) e a lista traz o grupo "Padaria do Bairro" (despesa, 1 lançamento, R$ 42,50, PJ). Os dois Pix pareados **não** aparecem.
2. O seletor de categoria do grupo lista categorias de despesa compatíveis com PJ (pessoais + "Pró-labore", "Fornecedores"…), sem categorias de receita.
3. Escolher `Supermercado`, deixar "Criar regra" e "Aplicar a parecidos" marcados e clicar **Categorizar**: a mensagem informa "1 lançamento(s) categorizado(s) … e regra criada", o contador vai a `0` e a lista fica vazia.
4. **Regras** mostra a regra nova (padrão "padaria do bairro", categoria Supermercado, acertos `0`).
5. Importar pela aba **Importar** um novo OFX na conta `Empresa PJ` com outra "Padaria do Bairro" em outra data. No console do navegador (`javascript_tool`), injetar o arquivo como na fase 11:

```js
const ofx = `OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>\n<BANKACCTFROM><BANKID>077<ACCTID>111-1</BANKACCTFROM>\n<BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260615<TRNAMT>-30.00<FITID>P9<MEMO>Padaria do Bairro</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const dt = new DataTransfer();
dt.items.add(new File([ofx], "teste2.ofx"));
const input = document.querySelector('.dropzone input[type=file]');
input.files = dt.files;
input.dispatchEvent(new Event("change", { bubbles: true }));
```

   Confirmar o preview (a conta `Empresa PJ` já vem reconhecida pelo número `111-1`), importar e, depois de alguns segundos, abrir **Transações**: o novo lançamento já tem a categoria Supermercado (a regra atuou) e **Para categorizar** continua vazio. Em **Regras**, os acertos da regra passam a `1`.
6. Em **Regras**, **Excluir** a regra (confirmar) e ver que ela some.
7. No **Dashboard**, selecionando junho de 2026, a despesa total é R$ 72,50 (42,50 + 30,00) e a receita R$ 0,00: os R$ 100 do Pix pareado não entram em nenhum dos dois. Em **Contas**, o saldo de cada conta continua refletindo o Pix (PJ −R$ 172,50, PF +R$ 100,00).

- [ ] **Step 5: Encerrar os servidores**

```bash
pkill -f 'turbo run dev'; pkill -f 'pnpm dev'; pkill -f 'tsx watch'; pkill -f 'nest start'; pkill -f vite
sleep 2
lsof -nP -iTCP:3100 -iTCP:5173 -sTCP:LISTEN | head -3
```

Esperado: sem saída. Os dados do usuário `f12_*` ficam no banco de desenvolvimento e são apagados pela próxima execução dos testes e2e.

- [ ] **Step 6: README**

Em `README.md`:
1. Trocar `11 migrations` por `12 migrations` e atualizar as contagens da seção "Testes" com os números do Step 1.
2. Em "Funcionalidades principais", acrescentar:

```markdown
- **Categorização automática e fila "Para categorizar"** — depois de importar, o sistema pareia transferências entre contas próprias (pelo nome do titular e da empresa ou pelo pagamento de fatura), aplica regras e usa IA em lote com limiar de confiança (configurável por workspace); o que sobra vira uma fila de pendentes agrupados por descrição, onde uma decisão cria regra e vale para lançamentos parecidos. Receita e despesa ignoram transferências pareadas e lançamentos ignorados
```

- [ ] **Step 7: Marcar o plano e commitar a documentação**

```bash
sed -i '' 's/^- \[ \] \*\*Step/- [x] **Step/' docs/superpowers/plans/2026-09-30-fase-12-categorizacao.md
grep -c '^- \[ \]' docs/superpowers/plans/2026-09-30-fase-12-categorizacao.md
git add -A
git commit -m "$(cat <<'EOF'
docs: fecha a Fase 12 (plano marcado, README com categorização automática e contagens)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
git status --short
```

Esperado: `grep -c` imprime `0` e `git status --short` fica vazio.

- [ ] **Step 8: Integrar em `main` (pedir autorização antes do push)**

Com autorização do usuário:

```bash
git checkout main
git merge --no-ff fase-12-categorizacao -m "Merge branch 'fase-12-categorizacao' into main"
git push origin main
```

Depois acompanhar o CI até concluir (`gh run list --limit 1`) e confirmar que todos os passos terminam em `success`.

---

## Self-Review

**Cobertura da spec (seções 3.2 e 5) e dos seguimentos:**
- 3.2 `Transaction` (`categorySource`, `categoryConfidence`, `reviewStatus`, `suggestedCategoryId`, `transferPairId` indexado, `ignored`; existentes com categoria → `manual`) → Task 1. `postedDate` já existe desde a fase 11; `installmentCurrent/Total` adiados (decisão 1).
- 3.2 regra de agregação → Task 6 (dashboard, chat, orçamentos, insights e previsão), saldo por conta intocado (decisão 7).
- 5.1 job `categorize`: transferências (Task 2 `detectTransferPairs` + Task 3 passo 1), regras filtradas por compatibilidade de tipo/entidade com `hitCount` (Task 1 coluna, Task 3 incremento), IA em lote com limiar, exemplos por trigramas (30), categorias por entidade, falha não derruba o job, `AiJob.result = { total, transfers, byRule, byAI→byAi, pending }` e `costTokens` acumulado (Task 3). A chave do resultado é `byAi` (a spec escreve `byAI`); é só o nome do campo JSON.
- 5.2 endpoints: `GET /review/pending`, `POST /review/categorize`, `accept-suggestion`, `mark-transfer`, `unpair`, `ignore`, `recategorize`, `PATCH /transactions/:id/category` com `applyToSimilar`/`similarCount`, `GET /category-rules` com `hitCount` → Task 4. `GET/PATCH /workspaces/current/settings` já existem (fase 10); Task 5 os torna sem escrita na leitura. Endpoint extra `transfer-candidates` e formato `{ total, groups }` documentados (decisões 2 e 4).
- 5.3 tela "Para categorizar" (pendentes agrupados, sugestão com aceitar, categoria do grupo, marcar transferência, ignorar, filtros PF/PJ e conta, contador, "Recategorizar pendentes", rascunhos com o comportamento atual) e 5.4 "Regras" (padrão, tipo, categoria, prioridade, acertos, excluir; acessível de dentro da tela) → Task 7.
- Seguimentos da fase 11 → Task 5: commit transacional com troca condicional de status, `categoryId` do commit validado, OFX malformado lança erro, pares soltos no desfazer. Da fase 10 → Task 5: `GET settings` sem escrita; Task 6 cobre a falta de teste do `entity`/agregação indiretamente.

**Varredura de placeholders:** todo passo de código traz o código. Os trechos descritivos são edições em arquivos que o implementador precisa ler antes (`draft-schema.ts` segue o formato do `INVOICE_JSON_SCHEMA`; `review.module.ts` e as exports de `TransactionsModule`/`CategoryRulesModule`; nomes de campos de `POST/GET /budgets`; as três consultas SQL do `compute.processor.ts`; o conteúdo original do template de rascunhos do `ReviewView.vue` a preservar). Cada um diz exatamente o que procurar e como adaptar.

**Consistência de tipos e nomes:** `TransferCandidate` (shared) é o tipo do pool do worker e do retorno de `detectTransferPairs`, que devolve `[despesaId, receitaId]`, mapeado para `{ expenseId, incomeId }` no plano e para `updateMany` no wrapper. `AiBatchResult`/`aiBatchResultSchema` (shared) são os mesmos do gateway e do núcleo. `CatRule extends Rule` e `matchRule` devolve a regra com `id`. `categoryFits(category, tx, accountEntity)` tem a mesma assinatura na API (review, updateCategory, similar-transactions) e no worker. `PendingGroup` do front espelha a resposta de `ReviewService.pending` (campos `key, type, description, count, totalCents, entity, suggestedCategoryId, transactionIds`). `findSimilarUncategorizedIds` é usado por `ReviewService.categorize` e por `TransactionsService.updateCategory`, com a mesma chave `tipo|descrição normalizada` do agrupamento da fila.

**Riscos registrados:** (a) o SQL dos insights do worker só é verificado manualmente (Task 8, Step 2); (b) a detecção de transferência depende de `ownerNames` preenchido; sem isso só o pagamento de fatura com conta de cartão pareia; (c) a IA real só é exercida com `OPENROUTER_API_KEY`: sem chave, tudo o que não tem regra vai para a fila (comportamento correto); (d) `applyToSimilar` atua só em lançamentos sem categoria, nunca sobrescreve categoria já definida.
