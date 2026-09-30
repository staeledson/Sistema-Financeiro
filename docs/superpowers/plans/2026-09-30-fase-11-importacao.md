# Fase 11 — Importação de extratos · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar extratos OFX e PDF do C6 Bank (PF e PJ) de ponta a ponta: o sistema detecta banco, tipo e conta pelo próprio arquivo, mostra um preview com duplicatas e conferência de saldo, grava, e permite desfazer o lote. Linhas idênticas no mesmo dia deixam de ser tratadas como duplicata. A fase também absorve os pendentes herdados das fases 9 e 10.

**Architecture:** Parsers determinísticos puros em `packages/shared/src/parsers/` (interface `StatementParser`: `detect` + `parse`, registro com `detectStatement`). A API recebe o arquivo em base64 (`POST /import/detect`), extrai o texto do PDF com `pdf-parse`, devolve o que reconheceu, e o front reenvia o texto para `POST /import/preview`. A conferência de saldo agrupa as linhas por **data contábil** entre dois "Saldo do dia" consecutivos (validado nos extratos reais fornecidos: PF 14/14 e PJ 92/92 pontos, mais o saldo do cabeçalho). `commit` continua gravando tudo de uma vez e enfileirando a categorização; `undo` apaga as transações do lote. O `ImportView` vira uma tela de um único passo de entrada com detecção automática.

**Tech Stack:** pnpm 11 + Turborepo, NestJS 11 + Fastify 5, Prisma 7, Zod 3, `pdf-parse` 2.4.5, Vue 3.5 + Pinia, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-contas-pf-pj-import-ia-dashboards-design.md`, seções 3.4, 3.6 e 4 (fase 3 da seção 10), com os desvios documentados abaixo.

## Decisões e desvios da spec (todos motivados por dados reais ou por escopo)

| # | Spec | Este plano | Motivo |
|---|---|---|---|
| 1 | Verificação de saldo: soma das linhas entre dois saldos, em ordem de arquivo | Agrupa por **data contábil** (`postedDate ?? date`) no intervalo `(saldo anterior, saldo atual]` | Em ordem de arquivo o extrato PJ real dá 12 divergências falsas; por data contábil dá 0 em PF e PJ |
| 2 | Saldos = "Saldo do dia" | Também usa o saldo do cabeçalho ("Saldo do dia • 5 de setembro de 2026", data da exportação) como último ponto, marcado como "saldo corrente": ele inclui lançamentos feitos antes da exportação mas contabilizados depois dela, então para esse ponto as linhas são somadas sem limite superior de data; é ignorado quando o período do extrato termina antes da data da exportação (incluiria movimentos fora do arquivo) | Fecha as linhas posteriores ao último "Saldo do dia" (3 linhas no PJ real) |
| 3 | `balanceCheck = { ok, expectedCents, computedCents, diffCents, checkedAt }` | `{ ok, checkedAt, checkpoints, mismatches: [{ dateISO, expectedCents, computedCents, diffCents }] }` | O extrato tem dezenas de pontos de conferência, não um |
| 4 | Fingerprint `sha1(…\|ordinal)` | String canônica `…\|ordinal` sem hash | Sem ganho do hash (não há segredo, coluna indexada como texto); a chave legada vira prefixo e permite compatibilidade |
| 5 | Upload do PDF para o MinIO e `storagePath` | PDF em base64 no JSON de `detect`; texto extraído no servidor e devolvido ao front | Testável sem MinIO; OFX Latin-1 também passa corretamente (bytes, não string). `bodyLimit` sobe para 20 MB. O arquivo original não é guardado (`fileRef` fica nulo) |
| 6 | Presets CSV do BB e do Inter, parser `ai-pdf` unificado, fatura de cartão C6, Mercado Pago | **Adiados** | Não há arquivo de exemplo de nenhum deles (a spec exige "layout a confirmar com arquivo real"). CSV segue pelo mapeamento manual atual; PDF desconhecido segue pelo caminho de IA atual (rascunhos em "Revisar") |
| 7 | Preview detecta pares de transferência e `undo` limpa `transferPairId` | **Adiado para a fase 12** | `transferPairId` é campo de `Transaction` da fase 12 (spec 3.2) |
| 8 | `postedDate` em `Transaction` é da fase 12 (3.2) | Só essa coluna (nula) entra agora | O parser já produz a data contábil; sem a coluna o dado seria perdido em importações feitas antes da fase 12 |
| 9 | `/import/ofx/preview` | Removido (substituído por `/import/preview`) | Código morto após a nova tela |

## Global Constraints

- Branch de trabalho: `fase-11-importacao`, criada a partir de `main` (Task 1, Step 1). Merge em `main` só com testes verdes.
- Portas locais: Postgres `5433`, Redis `6380`, MinIO `9010`/`9011`, API `3100`, Web `5173`. Nunca 5432/6379/9000/3000. Infra no ar para os testes da API: `docker compose up -d`.
- `ImportFormat` ganha `pdf_statement`. `ImportBatch` ganha `institution Institution?`, `detectedAccountRef String?`, `balanceCheck Json?`, `undoneAt DateTime?`. `Transaction` ganha `postedDate DateTime? @db.Date`.
- Fingerprint: `importFingerprint(accountId, dateISO, signedAmountCents, desc)` (chave base, inalterada) + `|ordinal` (posição entre linhas de chave idêntica no arquivo: 0, 1, 2…). OFX com FITID continua `ofx:{accountId}:{FITID}`.
- Dados reais pessoais (os PDFs em `~/Downloads`) **nunca** entram no repositório. Fixtures são sintéticas, com nomes e números fictícios. O teste com os arquivos reais só roda se eles existirem (`skipIf`) e não imprime conteúdo.
- Fora desta fase (não tocar): campos novos de `Transaction` além de `postedDate` (fase 12), categorização/transferências (fase 12), dashboards e visual novo (fase 13), presets CSV, `ai-pdf`, fatura de cartão, Mercado Pago.
- Migrations sem `prisma migrate dev`: SQL gerado por `prisma migrate diff --from-schema <schema antigo> --to-schema prisma/schema.prisma --script`.
- Commits pequenos, em português, `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Nunca `pnpm --filter … test run` (vira `vitest run run`): use `pnpm --filter … test` ou `pnpm --filter @app/api exec vitest run <arquivo>`.
- Testes e2e da API compartilham o banco `financas` e rodam em série; `cleanDb()` apaga tudo.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `prisma/schema.prisma` + `prisma/migrations/20260930180000_fase11_importacao/migration.sql` | modificar/criar | colunas novas e valor `pdf_statement` |
| `packages/shared/src/import.ts` | modificar | `ordinalFingerprints` |
| `packages/shared/src/ofx.ts` | modificar | `fitid` passa a ser `string \| null` |
| `packages/shared/src/parsers/types.ts` | criar | tipos e `StatementParseError` |
| `packages/shared/src/parsers/text.ts` | criar | valores BRL, datas em português, inferência de ano, divisão de células |
| `packages/shared/src/parsers/balance.ts` | criar | `verifyBalances` |
| `packages/shared/src/parsers/c6-statement.ts` | criar | parser do extrato C6 (PDF texto) |
| `packages/shared/src/parsers/ofx-statement.ts` | criar | parser OFX com banco/conta/saldo |
| `packages/shared/src/parsers/index.ts` | criar | registro e `detectStatement` |
| `packages/shared/src/parsers/__fixtures__/c6-sample.ts` | criar | extrato C6 sintético (usado por shared e API) |
| `packages/shared/src/queue.ts` | criar | `IngestJobData`, `IngestJobKind`, nomes da fila |
| `apps/api/src/import/pdf-text.ts` | criar | bytes → texto (PDF, UTF-8/Latin-1) |
| `apps/api/src/import/import-statement.service.ts` | criar | `detect`, `preview`, `undo`, `listBatches` |
| `apps/api/src/import/import.service.ts` / `.controller.ts` / `.module.ts` | modificar | fingerprint com ordinal, commit, rotas novas, remove `ofxPreview` |
| `apps/api/src/main.ts` | modificar | `bodyLimit`, shutdown hooks, `bootstrap().catch` |
| `apps/api/src/common/category-type-query.ts` | criar | validação de `?type=` |
| `apps/api/src/find-root.ts` e `apps/worker/src/find-root.ts` | criar | raiz do monorepo a partir de `src/` ou `dist/` |
| `apps/api/test/e2e/import-statements.e2e.test.ts` | criar | e2e de detect/preview/commit/undo/histórico |
| `apps/api/test/e2e/import-real-statements.test.ts` | criar | aceite com os PDFs reais (só local) |
| `apps/web/src/lib/import-client.ts` (+ teste) | criar | cliente e helpers da tela |
| `apps/web/src/views/ImportView.vue` | reescrever | detecção, preview com saldo, histórico e desfazer |
| `apps/worker/src/import/pdf.processor.ts`, `apps/worker/src/ai/ingest.processor.ts`, `apps/worker/src/queue.ts`, `apps/worker/package.json` | modificar | `destroy()` em `finally`, tipos da fila compartilhados, `tsx` |
| `README.md` | modificar | funcionalidade, contagens |

---

### Task 1: Modelo de dados (ImportBatch, `pdf_statement`, `postedDate`)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260930180000_fase11_importacao/migration.sql`
- Modify: `apps/api/test/database/schema.test.ts`

**Interfaces:**
- Produces (Prisma): `ImportFormat.pdf_statement`; `ImportBatch.institution: Institution | null`, `detectedAccountRef: string | null`, `balanceCheck: Json | null`, `undoneAt: Date | null`; `Transaction.postedDate: Date | null`.

- [x] **Step 1: Criar a branch**

```bash
git checkout main
git checkout -b fase-11-importacao
```

Esperado: `Switched to a new branch 'fase-11-importacao'`.

- [x] **Step 2: Escrever o teste de schema do banco (deve falhar)**

Em `apps/api/test/database/schema.test.ts`, acrescentar dentro do `describe("schema base", …)`, depois do último `it`:

```ts
  it("import_batches e transactions têm as colunas da fase 11", async () => {
    const cols = async (table: string) =>
      (await prisma.$queryRaw<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = ${table}`).map((r) => r.column_name);

    const batch = await cols("import_batches");
    for (const c of ["institution", "detectedAccountRef", "balanceCheck", "undoneAt"]) expect(batch).toContain(c);
    expect(await cols("transactions")).toContain("postedDate");
  });

  it("ImportFormat aceita pdf_statement", async () => {
    const rows = await prisma.$queryRaw<{ v: string }[]>`
      select unnest(enum_range(null::"ImportFormat"))::text as v`;
    expect(rows.map((r) => r.v)).toContain("pdf_statement");
  });
```

- [x] **Step 3: Rodar e confirmar a falha**

```bash
docker compose up -d
pnpm --filter @app/api exec vitest run test/database/schema.test.ts
```

Esperado: FAIL nos dois testes novos (colunas e valor de enum inexistentes).

- [x] **Step 4: Editar o `prisma/schema.prisma`**

1. No `enum ImportFormat`, acrescentar o valor:

```prisma
enum ImportFormat {
  csv
  ofx
  pdf
  pdf_statement
}
```

2. No `model ImportBatch`, acrescentar depois de `fileRef String?`:

```prisma
  institution        Institution?
  detectedAccountRef String?
  balanceCheck       Json?
  undoneAt           DateTime?
```

3. No `model Transaction`, acrescentar depois de `date DateTime @db.Date`:

```prisma
  postedDate      DateTime?       @db.Date
```

- [x] **Step 5: Gerar o SQL, aplicar e verificar**

O `HEAD` ainda tem o schema antigo (nada foi commitado).

```bash
git show HEAD:prisma/schema.prisma > "$TMPDIR/old.prisma"
mkdir -p prisma/migrations/20260930180000_fase11_importacao
pnpm exec prisma migrate diff --from-schema "$TMPDIR/old.prisma" --to-schema prisma/schema.prisma \
  --script -o prisma/migrations/20260930180000_fase11_importacao/migration.sql
grep -E "ALTER TYPE|ADD COLUMN|DROP" prisma/migrations/20260930180000_fase11_importacao/migration.sql
```

Esperado: um `ALTER TYPE "ImportFormat" ADD VALUE 'pdf_statement'` e `ADD COLUMN` em `import_batches` (4) e `transactions` (1); **nenhum** `DROP`. (O novo valor de enum não é usado dentro da própria migration, então pode ficar no mesmo arquivo.)

```bash
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script | grep -c "empty migration"
```

Esperado: migration aplicada e a contagem final `1` (sem drift).

- [x] **Step 6: Rodar testes e typecheck**

```bash
pnpm --filter @app/api exec vitest run test/database/schema.test.ts
pnpm turbo typecheck
```

Esperado: 6 testes passam em `schema.test.ts` e typecheck verde nos 4 pacotes.

- [x] **Step 7: Commit**

```bash
git add prisma apps/api/test/database/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(db): ImportBatch com instituição, conta detectada, conferência de saldo e desfazer; Transaction.postedDate

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Núcleo dos parsers (tipos, texto, fingerprint com ordinal, conferência de saldo)

**Files:**
- Create: `packages/shared/src/parsers/types.ts`
- Create: `packages/shared/src/parsers/text.ts`
- Create: `packages/shared/src/parsers/balance.ts`
- Modify: `packages/shared/src/import.ts`
- Create: `packages/shared/src/__tests__/statement-core.test.ts`

**Interfaces:**
- Produces (todos de `packages/shared/src/parsers/*`, reexportados por `@app/shared` na Task 3):
  - `types.ts`: `StatementKind = "statement" | "card_invoice"`, `StatementFormat = "ofx" | "pdf_statement"`, `DetectResult { institution: Institution; kind: StatementKind; format: StatementFormat; accountRef: string | null; confidence: number }`, `ParsedRow { type: "income" | "expense"; amountCents: number; date: string; postedDate: string | null; description: string | null; fingerprint: string }` (`amountCents` sempre positivo; `date` = lançamento, `YYYY-MM-DD`), `BalancePoint { dateISO: string; balanceCents: number }`, `ParsedStatement { rows: ParsedRow[]; balances: BalancePoint[]; accountRef: string | null; period: { from: string; to: string } | null }`, `StatementParser { id: string; detect(text: string): DetectResult | null; parse(text: string, ctx: { accountId: string }): ParsedStatement }`, `class StatementParseError extends Error`.
  - `text.ts`: `parseBrlCents(raw: string): number | null`, `toISODate(y: number, m: number, d: number): string | null`, `inferYearISO(day: number, month: number, fromISO: string, toISO: string): string | null`, `monthFromName(name: string): number | null`, `parsePtLongDate(day: string, monthName: string, year: string): string | null`, `splitCells(line: string): string[]`.
  - `balance.ts`: `BalanceMismatch { dateISO; expectedCents; computedCents; diffCents }`, `BalanceCheck { ok; checkedAt; checkpoints; mismatches }`, `verifyBalances(rows, balances, now?): BalanceCheck | null`.
  - `import.ts`: `ordinalFingerprints(keys: string[]): string[]` (devolve `${key}|${n}`, `n` = quantas chaves iguais apareceram antes).

- [x] **Step 1: Escrever os testes (devem falhar)**

Criar `packages/shared/src/__tests__/statement-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ordinalFingerprints, importFingerprint } from "../import";
import {
  parseBrlCents, toISODate, inferYearISO, monthFromName, parsePtLongDate, splitCells,
} from "../parsers/text";
import { verifyBalances } from "../parsers/balance";

describe("ordinalFingerprints", () => {
  it("numera linhas de chave idêntica na ordem do arquivo", () => {
    expect(ordinalFingerprints(["a", "b", "a", "a", "b"])).toEqual(["a|0", "b|0", "a|1", "a|2", "b|1"]);
  });

  it("duas linhas iguais no mesmo dia geram fingerprints diferentes", () => {
    const k = importFingerprint("acc1", "2026-06-10", -2000, "Pix enviado para Padaria");
    const [a, b] = ordinalFingerprints([k, k]);
    expect(a).not.toBe(b);
    expect(a.startsWith(`${k}|`)).toBe(true);
  });

  it("é determinístico entre execuções", () => {
    expect(ordinalFingerprints(["x", "x"])).toEqual(ordinalFingerprints(["x", "x"]));
  });
});

describe("parseBrlCents", () => {
  it("lê valores com e sem sinal, milhar e zero", () => {
    expect(parseBrlCents("R$ 1.234,56")).toBe(123456);
    expect(parseBrlCents("-R$ 500,00")).toBe(-50000);
    expect(parseBrlCents("- R$ 5,00")).toBe(-500);
    expect(parseBrlCents("R$ 0,00")).toBe(0);
    expect(parseBrlCents("R$ 12.345.678,90")).toBe(1234567890);
  });

  it("devolve null para o que não é valor", () => {
    expect(parseBrlCents("abc")).toBeNull();
    expect(parseBrlCents("R$ 10")).toBeNull();
    expect(parseBrlCents("")).toBeNull();
  });
});

describe("datas", () => {
  it("toISODate valida o calendário", () => {
    expect(toISODate(2025, 10, 5)).toBe("2025-10-05");
    expect(toISODate(2025, 2, 29)).toBeNull();
    expect(toISODate(2024, 2, 29)).toBe("2024-02-29");
    expect(toISODate(2025, 13, 1)).toBeNull();
  });

  it("inferYearISO escolhe o ano mais próximo do meio do período", () => {
    // lançamento 30/10 dentro de outubro de 2025
    expect(inferYearISO(30, 10, "2025-10-01", "2025-10-31")).toBe("2025-10-30");
    // data contábil 01/11 listada no bloco de outubro
    expect(inferYearISO(1, 11, "2025-10-01", "2025-10-31")).toBe("2025-11-01");
    // lançamento 30/12 listado no bloco de janeiro de 2026
    expect(inferYearISO(30, 12, "2026-01-01", "2026-01-31")).toBe("2025-12-30");
    // contábil 02/01 listado no bloco de dezembro de 2025
    expect(inferYearISO(2, 1, "2025-12-01", "2025-12-31")).toBe("2026-01-02");
  });

  it("inferYearISO devolve null para dia inexistente", () => {
    expect(inferYearISO(31, 2, "2025-02-01", "2025-02-28")).toBeNull();
  });

  it("monthFromName e parsePtLongDate", () => {
    expect(monthFromName("Março")).toBe(3);
    expect(monthFromName("setembro")).toBe(9);
    expect(monthFromName("xyz")).toBeNull();
    expect(parsePtLongDate("5", "setembro", "2026")).toBe("2026-09-05");
    expect(parsePtLongDate("5", "xyz", "2026")).toBeNull();
  });
});

describe("splitCells", () => {
  it("divide por tabulação (saída do pdf-parse) preservando espaços internos", () => {
    expect(splitCells("19/09 \t19/09 \tEntrada PIX \tPix recebido de A  B \tR$ 500,00")).toEqual([
      "19/09", "19/09", "Entrada PIX", "Pix recebido de A  B", "R$ 500,00",
    ]);
  });

  it("divide por 2+ espaços quando não há tabulação (pdftotext -layout)", () => {
    expect(splitCells("19/09      19/09      Entrada PIX     Pix recebido de A      R$ 500,00")).toEqual([
      "19/09", "19/09", "Entrada PIX", "Pix recebido de A", "R$ 500,00",
    ]);
  });
});

describe("verifyBalances", () => {
  const row = (type: "income" | "expense", amountCents: number, date: string, postedDate: string | null = null) => ({
    type, amountCents, date, postedDate,
  });
  const NOW = new Date("2026-01-01T00:00:00Z");

  it("devolve null sem pelo menos dois pontos de saldo", () => {
    expect(verifyBalances([], [], NOW)).toBeNull();
    expect(verifyBalances([row("income", 100, "2025-10-01")], [{ dateISO: "2025-10-01", balanceCents: 100 }], NOW)).toBeNull();
  });

  it("confere cada intervalo (anterior, atual] pelo saldo anterior declarado", () => {
    const rows = [row("income", 1000, "2025-10-02"), row("expense", 500, "2025-10-03"), row("expense", 100, "2025-10-05")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-02", balanceCents: 1000 }, // âncora: não verifica nada atrás dela
      { dateISO: "2025-10-04", balanceCents: 500 },
      { dateISO: "2025-10-06", balanceCents: 400 },
    ], NOW);
    expect(check).toEqual({ ok: true, checkedAt: NOW.toISOString(), checkpoints: 2, mismatches: [] });
  });

  it("agrupa pela data contábil, não pela posição nem pela data de lançamento", () => {
    // lançada em 05/10 mas contábil em 03/10: entra no intervalo (02/10, 04/10]
    const rows = [row("expense", 500, "2025-10-05", "2025-10-03")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-02", balanceCents: 1000 },
      { dateISO: "2025-10-04", balanceCents: 500 },
    ], NOW);
    expect(check?.ok).toBe(true);
  });

  it("aceita os pontos fora de ordem e ordena por data", () => {
    const rows = [row("expense", 100, "2025-10-03")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-04", balanceCents: 900 },
      { dateISO: "2025-10-02", balanceCents: 1000 },
    ], NOW);
    expect(check?.ok).toBe(true);
  });

  it("registra cada divergência com esperado, calculado e diferença (esperado − calculado)", () => {
    const rows = [row("expense", 100, "2025-10-03")];
    const check = verifyBalances(rows, [
      { dateISO: "2025-10-02", balanceCents: 1000 },
      { dateISO: "2025-10-04", balanceCents: 950 },
    ], NOW);
    expect(check?.ok).toBe(false);
    expect(check?.mismatches).toEqual([{ dateISO: "2025-10-04", expectedCents: 950, computedCents: 900, diffCents: 50 }]);
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/shared test
```

Esperado: FAIL no novo arquivo (módulos `../parsers/*` e `ordinalFingerprints` inexistentes). Os testes antigos continuam passando.

- [x] **Step 3: Implementar**

Em `packages/shared/src/import.ts`, acrescentar ao final do arquivo:

```ts
/**
 * Fingerprint estável para linhas de chave idêntica no mesmo arquivo (ex.: dois Pix iguais no mesmo dia):
 * cada chave recebe o sufixo `|n`, onde n é quantas chaves iguais apareceram antes dela.
 */
export function ordinalFingerprints(keys: string[]): string[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `${k}|${n}`;
  });
}
```

Criar `packages/shared/src/parsers/types.ts`:

```ts
import type { Institution } from "../enums";

export type StatementKind = "statement" | "card_invoice";
export type StatementFormat = "ofx" | "pdf_statement";

export interface DetectResult {
  institution: Institution;
  kind: StatementKind;
  format: StatementFormat;
  /** Número da conta (ou final do cartão) como aparece no arquivo; usado para reconhecer a conta cadastrada. */
  accountRef: string | null;
  /** 0–1. Abaixo de 0,5 o arquivo é tratado como não reconhecido. */
  confidence: number;
}

export interface ParsedRow {
  type: "income" | "expense";
  /** Sempre positivo; o sentido está em `type`. */
  amountCents: number;
  /** Data do lançamento, YYYY-MM-DD. */
  date: string;
  /** Data contábil, YYYY-MM-DD (quando o banco informa). */
  postedDate: string | null;
  description: string | null;
  fingerprint: string;
}

export interface BalancePoint {
  dateISO: string;
  balanceCents: number;
}

export interface ParsedStatement {
  rows: ParsedRow[];
  balances: BalancePoint[];
  accountRef: string | null;
  period: { from: string; to: string } | null;
}

export interface StatementParser {
  id: string;
  detect(text: string): DetectResult | null;
  parse(text: string, ctx: { accountId: string }): ParsedStatement;
}

export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementParseError";
  }
}
```

Criar `packages/shared/src/parsers/text.ts`:

```ts
const MONTHS_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

export function monthFromName(name: string): number | null {
  return MONTHS_PT[name.trim().toLowerCase()] ?? null;
}

/** "R$ 1.234,56" → 123456; "-R$ 500,00" → -50000; o que não for valor → null. */
export function parseBrlCents(raw: string): number | null {
  const m = raw.trim().match(/^(-?)\s*R\$\s*(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})$/);
  if (!m) return null;
  const cents = Number(m[2].replace(/\./g, "") + m[3]);
  return m[1] ? -cents : cents;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD se a data existe no calendário; senão null. */
export function toISODate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Extratos trazem só dd/mm. O ano é o que deixa a data mais perto do meio do período do bloco
 * (cobre lançamento de 30/12 listado no bloco de janeiro e contábil de 02/01 listado no de dezembro).
 */
export function inferYearISO(day: number, month: number, fromISO: string, toISO: string): string | null {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  const mid = (from + to) / 2;
  const fromY = new Date(from).getUTCFullYear();
  const toY = new Date(to).getUTCFullYear();
  let best: { iso: string; dist: number } | null = null;
  for (let y = fromY - 1; y <= toY + 1; y++) {
    const iso = toISODate(y, month, day);
    if (!iso) continue;
    const dist = Math.abs(Date.parse(`${iso}T00:00:00Z`) - mid);
    if (!best || dist < best.dist) best = { iso, dist };
  }
  return best?.iso ?? null;
}

/** "5", "setembro", "2026" → "2026-09-05". */
export function parsePtLongDate(day: string, monthName: string, year: string): string | null {
  const month = monthFromName(monthName);
  return month ? toISODate(Number(year), month, Number(day)) : null;
}

/** Colunas de uma linha de extrato: por tabulação (pdf-parse) ou, sem tabulação, por 2+ espaços (pdftotext -layout). */
export function splitCells(line: string): string[] {
  const t = line.trim();
  return t.includes("\t") ? t.split(/\s*\t\s*/) : t.split(/\s{2,}/);
}
```

Criar `packages/shared/src/parsers/balance.ts`:

```ts
import type { BalancePoint, ParsedRow } from "./types";

export interface BalanceMismatch {
  dateISO: string;
  expectedCents: number;
  computedCents: number;
  /** esperado − calculado */
  diffCents: number;
}

export interface BalanceCheck {
  ok: boolean;
  checkedAt: string;
  /** Quantos intervalos foram conferidos (pontos de saldo − 1). */
  checkpoints: number;
  mismatches: BalanceMismatch[];
}

const signed = (r: Pick<ParsedRow, "type" | "amountCents">) => (r.type === "income" ? r.amountCents : -r.amountCents);

/**
 * Confere o extrato contra os saldos que ele mesmo declara. Para cada par de pontos consecutivos,
 * saldo calculado = saldo anterior + soma das linhas com data contábil (ou de lançamento, se não houver)
 * em (data anterior, data atual]. O primeiro ponto é a âncora e não é verificado.
 * Devolve null quando o arquivo traz menos de dois pontos.
 */
export function verifyBalances(
  rows: Pick<ParsedRow, "type" | "amountCents" | "date" | "postedDate">[],
  balances: BalancePoint[],
  now: Date = new Date(),
): BalanceCheck | null {
  if (balances.length < 2) return null;
  const points = [...balances].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const mismatches: BalanceMismatch[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    let computed = prev.balanceCents;
    for (const r of rows) {
      const d = r.postedDate ?? r.date;
      if (d > prev.dateISO && d <= cur.dateISO) computed += signed(r);
    }
    if (computed !== cur.balanceCents) {
      mismatches.push({
        dateISO: cur.dateISO,
        expectedCents: cur.balanceCents,
        computedCents: computed,
        diffCents: cur.balanceCents - computed,
      });
    }
  }
  return { ok: mismatches.length === 0, checkedAt: now.toISOString(), checkpoints: points.length - 1, mismatches };
}
```

- [x] **Step 4: Rodar testes e typecheck**

```bash
pnpm --filter @app/shared test
pnpm --filter @app/shared typecheck
```

Esperado: todos passam (48 anteriores + 16 novos) e typecheck verde. (Os módulos novos ainda não são reexportados; isso acontece na Task 3.)

- [x] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "$(cat <<'EOF'
feat(shared): núcleo dos parsers de extrato (tipos, texto BRL/datas, ordinal no fingerprint, conferência de saldo por data contábil)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Parsers do C6 (PDF) e OFX, registro de detecção e fixture sintética

**Files:**
- Create: `packages/shared/src/parsers/__fixtures__/c6-sample.ts`
- Create: `packages/shared/src/parsers/c6-statement.ts`
- Create: `packages/shared/src/parsers/ofx-statement.ts`
- Create: `packages/shared/src/parsers/index.ts`
- Modify: `packages/shared/src/ofx.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/__tests__/statement-parsers.test.ts`

**Interfaces:**
- Consumes (Task 2): todos os tipos e helpers de `parsers/types|text|balance`, `importFingerprint`, `ordinalFingerprints`, `parseOfx`.
- Produces:
  - `c6StatementParser: StatementParser` (`id: "c6-statement"`), `ofxStatementParser: StatementParser` (`id: "ofx"`), `STATEMENT_PARSERS`, `detectStatement(text): { parser: StatementParser; detected: DetectResult } | null` (maior confiança; abaixo de 0,5 → null).
  - `OfxTxn.fitid` passa a `string | null` (sem fallback inventado).
  - `@app/shared` exporta `./parsers` (tipos, parsers, `verifyBalances`, `detectStatement`, helpers de `text`).
  - Fixture (não exportada pelo `index.ts`): `packages/shared/src/parsers/__fixtures__/c6-sample.ts` com `c6SampleText(opts?: { layout?: boolean; corruptBalance?: boolean }): string` e `C6_SAMPLE` (constantes esperadas). A API a importa por caminho relativo.

- [x] **Step 1: Criar a fixture sintética do C6**

O extrato abaixo é fictício (nomes e números inventados) e reproduz a estrutura dos extratos reais: cabeçalho, blocos mensais, linhas com data de lançamento e contábil diferentes, "Saldo do dia", linha listada depois do saldo do dia a que pertence, duas linhas idênticas no mesmo dia, e saldo final no cabeçalho.

Criar `packages/shared/src/parsers/__fixtures__/c6-sample.ts`:

```ts
/**
 * Extrato C6 sintético (dados fictícios) no formato de texto do pdf-parse:
 * colunas separadas por " \t". Com `layout: true` usa 3+ espaços (formato do pdftotext -layout).
 */
export const C6_SAMPLE = {
  conta: "123456789",
  rowCount: 9,
  period: { from: "2025-10-01", to: "2025-11-05" },
  /** Pontos de saldo: 4 "Saldo do dia" + o saldo do cabeçalho. */
  balances: [
    { dateISO: "2025-10-02", balanceCents: 84950 },
    { dateISO: "2025-10-10", balanceCents: 80950 },
    { dateISO: "2025-10-29", balanceCents: 76000 },
    { dateISO: "2025-11-03", balanceCents: 51000 },
    { dateISO: "2025-11-05", balanceCents: 50000 },
  ],
  checkpoints: 4,
} as const;

export function c6SampleText(opts: { layout?: boolean; corruptBalance?: boolean } = {}): string {
  const sep = opts.layout ? "      " : " \t";
  const row = (...cells: string[]) => cells.join(sep);
  // "Saldo do dia 29/10/25" correto = R$ 760,00; corrompido = R$ 769,50 (esquece a tarifa de R$ 9,50)
  const saldo29 = opts.corruptBalance ? "R$ 769,50" : "R$ 760,00";

  return [
    "Extrato exportado no dia 5 de novembro de 2025 às 16:20",
    "FULANO DE TESTE • 000.000.000-00",
    `Agência: 1 • Conta: ${C6_SAMPLE.conta}`,
    "Extrato Período • 1 de outubro de 2025 até 5 de novembro de 2025",
    "Saldo do dia • 5 de novembro de 2025 • R$ 500,00",
    `Outubro 2025 ( 01/10/2025 - 31/10/2025 )${sep}Entradas: R$ 1.000,00 • Saídas: R$ 719,50`,
    "Data",
    "lançamento",
    "Data",
    row("contábil", "Tipo", "Descrição", "Valor"),
    row("02/10", "02/10", "Entrada PIX", "Pix recebido de Cliente A", "R$ 1.000,00"),
    row("02/10", "02/10", "Saída PIX", "Pix enviado para Mercado X", "-R$ 250,50"),
    row("Saldo do dia 02/10/25", "R$ 849,50"),
    row("10/10", "10/10", "Saída PIX", "Pix enviado para Padaria", "-R$ 20,00"),
    row("10/10", "10/10", "Saída PIX", "Pix enviado para Padaria", "-R$ 20,00"),
    row("Saldo do dia 10/10/25", "R$ 809,50"),
    row("29/10", "29/10", "Saída PIX", "Pix enviado para Loja", "-R$ 40,00"),
    row("Saldo do dia 29/10/25", saldo29),
    // pertence ao saldo de 29/10 (contábil 28/10), mas o extrato a lista depois dele
    row("28/10", "28/10", "Outros gastos", "Tarifa de manutenção", "-R$ 9,50"),
    // lançada em 29/10, contábil em 01/11 (já no mês seguinte), listada no bloco de outubro: como o saldo de 29/10
    // não a inclui, somar pela data de lançamento faria esse saldo divergir (o teste de conferência depende disso)
    row("29/10", "01/11", "Pagamento", "PGTO FAT CARTAO C6", "-R$ 300,00"),
    `Novembro 2025 ( 01/11/2025 - 30/11/2025 )${sep}Entradas: R$ 50,00 • Saídas: R$ 10,00`,
    "Data",
    "lançamento",
    "Data",
    row("contábil", "Tipo", "Descrição", "Valor"),
    row("03/11", "03/11", "Entrada PIX", "Pix recebido de Cliente B", "R$ 50,00"),
    row("Saldo do dia 03/11/25", "R$ 510,00"),
    row("04/11", "04/11", "Saída PIX", "Pix enviado para Farmácia", "-R$ 10,00"),
    "-- 1 of 1 --",
    "Informações sujeitas a alteração até o final do dia",
    "Atendimento 24 horas",
  ].join("\n");
}
```

- [x] **Step 2: Escrever os testes dos parsers (devem falhar)**

Criar `packages/shared/src/__tests__/statement-parsers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  c6StatementParser, ofxStatementParser, detectStatement, verifyBalances, StatementParseError, parseOfx,
} from "../index";
import { C6_SAMPLE, c6SampleText } from "../parsers/__fixtures__/c6-sample";

describe("c6StatementParser.detect", () => {
  it("reconhece o layout e extrai a conta", () => {
    expect(c6StatementParser.detect(c6SampleText())).toEqual({
      institution: "c6", kind: "statement", format: "pdf_statement", accountRef: C6_SAMPLE.conta, confidence: 0.85,
    });
  });

  it("não reconhece texto qualquer", () => {
    expect(c6StatementParser.detect("Compra Netflix 15/06/2026 R$ 55,90")).toBeNull();
  });

  it("sobe a confiança quando o texto cita C6 Bank", () => {
    expect(c6StatementParser.detect(`${c6SampleText()}\nNo app do C6 Bank`)?.confidence).toBe(0.95);
  });
});

describe("c6StatementParser.parse", () => {
  const parsed = c6StatementParser.parse(c6SampleText(), { accountId: "acc1" });

  it("lê as 9 linhas com tipo, valor positivo, data de lançamento e contábil", () => {
    expect(parsed.rows).toHaveLength(C6_SAMPLE.rowCount);
    expect(parsed.rows[0]).toMatchObject({
      type: "income", amountCents: 100000, date: "2025-10-02", postedDate: "2025-10-02",
      description: "Pix recebido de Cliente A",
    });
    expect(parsed.rows[1]).toMatchObject({ type: "expense", amountCents: 25050 });
  });

  it("infere o ano pelo bloco mensal, inclusive para a data contábil do mês seguinte", () => {
    const fatura = parsed.rows.find((r) => r.description === "PGTO FAT CARTAO C6");
    expect(fatura).toMatchObject({ date: "2025-10-29", postedDate: "2025-11-01", type: "expense", amountCents: 30000 });
  });

  it("lê período, conta e os pontos de saldo (Saldo do dia + saldo do cabeçalho)", () => {
    expect(parsed.period).toEqual(C6_SAMPLE.period);
    expect(parsed.accountRef).toBe(C6_SAMPLE.conta);
    expect([...parsed.balances].sort((a, b) => a.dateISO.localeCompare(b.dateISO))).toEqual(C6_SAMPLE.balances);
  });

  it("duas linhas idênticas no mesmo dia têm fingerprints diferentes", () => {
    const padarias = parsed.rows.filter((r) => r.description === "Pix enviado para Padaria");
    expect(padarias).toHaveLength(2);
    expect(padarias[0].fingerprint).not.toBe(padarias[1].fingerprint);
    expect(new Set(parsed.rows.map((r) => r.fingerprint)).size).toBe(parsed.rows.length);
  });

  it("os saldos declarados fecham com as linhas (conferência por data contábil)", () => {
    const check = verifyBalances(parsed.rows, parsed.balances);
    expect(check?.ok).toBe(true);
    expect(check?.checkpoints).toBe(C6_SAMPLE.checkpoints);
  });

  it("reimportar o mesmo texto gera os mesmos fingerprints", () => {
    const again = c6StatementParser.parse(c6SampleText(), { accountId: "acc1" });
    expect(again.rows.map((r) => r.fingerprint)).toEqual(parsed.rows.map((r) => r.fingerprint));
  });

  it("o fingerprint depende da conta", () => {
    const other = c6StatementParser.parse(c6SampleText(), { accountId: "acc2" });
    expect(other.rows[0].fingerprint).not.toBe(parsed.rows[0].fingerprint);
  });

  it("um saldo do dia errado aparece como divergência (esperado − calculado)", () => {
    const bad = c6StatementParser.parse(c6SampleText({ corruptBalance: true }), { accountId: "acc1" });
    const check = verifyBalances(bad.rows, bad.balances);
    expect(check?.ok).toBe(false);
    expect(check?.mismatches.map((m) => [m.dateISO, m.diffCents])).toEqual([
      ["2025-10-29", 950],
      ["2025-11-03", -950],
    ]);
  });

  it("aceita o texto no formato pdftotext -layout (colunas por 2+ espaços)", () => {
    const layout = c6StatementParser.parse(c6SampleText({ layout: true }), { accountId: "acc1" });
    expect(layout.rows.map((r) => [r.date, r.postedDate, r.type, r.amountCents, r.description])).toEqual(
      parsed.rows.map((r) => [r.date, r.postedDate, r.type, r.amountCents, r.description]),
    );
    expect(verifyBalances(layout.rows, layout.balances)?.ok).toBe(true);
  });

  it("lança StatementParseError para linha fora de um bloco mensal", () => {
    const text = "02/10 \t02/10 \tEntrada PIX \tPix \tR$ 1,00";
    expect(() => c6StatementParser.parse(text, { accountId: "a" })).toThrow(StatementParseError);
  });

  it("lança StatementParseError quando não encontra nenhum lançamento nem saldo", () => {
    expect(() => c6StatementParser.parse("nada aqui", { accountId: "a" })).toThrow(StatementParseError);
  });
});

const OFX_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0077<ACCTID>98765-4</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260605120000[-3:BRT]
<TRNAMT>-35.00
<FITID>A1
<MEMO>iFood Pagamento
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260610
<TRNAMT>5000,00
<FITID>A2
<NAME>Salário
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260611
<TRNAMT>-10.00
<MEMO>Sem FITID
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260611
<TRNAMT>-10.00
<MEMO>Sem FITID
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1234.56<DTASOF>20260630</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("ofxStatementParser", () => {
  it("detecta banco pelo BANKID, conta pelo ACCTID e formato ofx", () => {
    expect(ofxStatementParser.detect(OFX_SAMPLE)).toEqual({
      institution: "inter", kind: "statement", format: "ofx", accountRef: "98765-4", confidence: 0.95,
    });
  });

  it("mapeia BANKID conhecidos e cai em other nos demais", () => {
    const at = (id: string) => ofxStatementParser.detect(`<OFX><BANKID>${id}<ACCTID>1</OFX>`)?.institution;
    expect(at("001")).toBe("bb");
    expect(at("336")).toBe("c6");
    expect(at("323")).toBe("mercado_pago");
    expect(at("999")).toBe("other");
  });

  it("cartão: CCACCTFROM vira card_invoice", () => {
    const d = ofxStatementParser.detect("<OFX><CREDITCARDMSGSRSV1><CCACCTFROM><ACCTID>4321</CCACCTFROM></OFX>");
    expect(d).toMatchObject({ kind: "card_invoice", accountRef: "4321", format: "ofx" });
  });

  it("não detecta texto que não é OFX", () => {
    expect(ofxStatementParser.detect("Data;Valor\n01/01/2026;10,00")).toBeNull();
  });

  it("parse: linhas, sinal, data, vírgula decimal e memo/name", () => {
    const parsed = ofxStatementParser.parse(OFX_SAMPLE, { accountId: "acc1" });
    expect(parsed.rows.map((r) => [r.type, r.amountCents, r.date, r.description])).toEqual([
      ["expense", 3500, "2026-06-05", "iFood Pagamento"],
      ["income", 500000, "2026-06-10", "Salário"],
      ["expense", 1000, "2026-06-11", "Sem FITID"],
      ["expense", 1000, "2026-06-11", "Sem FITID"],
    ]);
    expect(parsed.accountRef).toBe("98765-4");
    expect(parsed.period).toEqual({ from: "2026-06-05", to: "2026-06-11" });
  });

  it("fingerprint: FITID vira ofx:{conta}:{fitid}; sem FITID usa chave com ordinal (linhas iguais não colidem)", () => {
    const rows = ofxStatementParser.parse(OFX_SAMPLE, { accountId: "acc1" }).rows;
    expect(rows[0].fingerprint).toBe("ofx:acc1:A1");
    expect(rows[1].fingerprint).toBe("ofx:acc1:A2");
    expect(rows[2].fingerprint).toBe("acc1|2026-06-11|-1000|sem fitid|0");
    expect(rows[3].fingerprint).toBe("acc1|2026-06-11|-1000|sem fitid|1");
  });

  it("lê o saldo (BALAMT/DTASOF), que sozinho não permite conferência", () => {
    const parsed = ofxStatementParser.parse(OFX_SAMPLE, { accountId: "acc1" });
    expect(parsed.balances).toEqual([{ dateISO: "2026-06-30", balanceCents: 123456 }]);
    expect(verifyBalances(parsed.rows, parsed.balances)).toBeNull();
  });

  it("parseOfx deixa fitid nulo quando o arquivo não traz FITID", () => {
    expect(parseOfx(OFX_SAMPLE).map((t) => t.fitid)).toEqual(["A1", "A2", null, null]);
  });

  it("lança StatementParseError quando não há transações", () => {
    expect(() => ofxStatementParser.parse("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>", { accountId: "a" })).toThrow(
      StatementParseError,
    );
  });
});

describe("detectStatement", () => {
  it("escolhe o parser de maior confiança", () => {
    expect(detectStatement(c6SampleText())?.parser.id).toBe("c6-statement");
    expect(detectStatement(OFX_SAMPLE)?.parser.id).toBe("ofx");
    expect(detectStatement(OFX_SAMPLE)?.detected.institution).toBe("inter");
  });

  it("devolve null para texto não reconhecido", () => {
    expect(detectStatement("qualquer coisa")).toBeNull();
    expect(detectStatement("")).toBeNull();
  });
});
```

- [x] **Step 3: Rodar e confirmar a falha**

```bash
pnpm --filter @app/shared test
```

Esperado: FAIL no novo arquivo (`c6StatementParser`, `ofxStatementParser`, `detectStatement`, `StatementParseError` não exportados por `../index`; fitid com fallback).

- [x] **Step 4: Ajustar `parseOfx` (fitid sem fallback)**

Substituir `packages/shared/src/ofx.ts` por:

```ts
export type OfxTxn = {
  /** Null quando o arquivo não traz FITID para a transação. */
  fitid: string | null;
  dateISO: string;
  amountCents: number;
  memo: string | null;
};

export function parseOfx(text: string): OfxTxn[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string): string | null => {
    const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i"));
    return m ? m[1].trim() : null;
  };
  return blocks.map((b) => {
    const dt = tag(b, "DTPOSTED") ?? "";
    const dateISO = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const amtRaw = (tag(b, "TRNAMT") ?? "0").replace(",", ".");
    const amt = parseFloat(amtRaw);
    return {
      fitid: tag(b, "FITID") || null,
      dateISO,
      amountCents: Math.round(amt * 100),
      memo: tag(b, "MEMO") ?? tag(b, "NAME"),
    };
  });
}
```

- [x] **Step 5: Implementar o parser do C6**

Criar `packages/shared/src/parsers/c6-statement.ts`:

```ts
import { importFingerprint, ordinalFingerprints } from "../import";
import { inferYearISO, parseBrlCents, parsePtLongDate, splitCells, toISODate } from "./text";
import {
  StatementParseError,
  type BalancePoint,
  type DetectResult,
  type ParsedRow,
  type ParsedStatement,
  type StatementParser,
} from "./types";

const MONTH_BLOCK = /^\S+ \d{4} \( (\d{2})\/(\d{2})\/(\d{4}) - (\d{2})\/(\d{2})\/(\d{4}) \)/;
const BALANCE_DAY = /^Saldo do dia (\d{2})\/(\d{2})\/(\d{2})\s+(-?\s*R\$\s*[\d.]+,\d{2})$/;
const BALANCE_EXPORT = /^Saldo do dia \S+ (\d{1,2}) de (\S+) de (\d{4}) \S+ (-?\s*R\$\s*[\d.]+,\d{2})$/;
const PERIOD = /Período \S+ (\d{1,2}) de (\S+) de (\d{4}) até (\d{1,2}) de (\S+) de (\d{4})/;
const ACCOUNT = /Ag[eê]ncia:\s*\d+\s+\S+\s+Conta:\s*(\d+)/;
const DAY_MONTH = /^(\d{2})\/(\d{2})$/;

function normalize(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export const c6StatementParser: StatementParser = {
  id: "c6-statement",

  detect(text: string): DetectResult | null {
    const t = text.normalize("NFC");
    const hasMonthBlock = /^\s*\S+ \d{4} \( \d{2}\/\d{2}\/\d{4} - \d{2}\/\d{2}\/\d{4} \)/m.test(t);
    const hasColumns = /lançamento/i.test(t) && /contábil/i.test(t);
    const hasBalance = /Saldo do dia/.test(t);
    if (!(hasMonthBlock && hasColumns && hasBalance)) return null;
    return {
      institution: "c6",
      kind: "statement",
      format: "pdf_statement",
      accountRef: t.match(ACCOUNT)?.[1] ?? null,
      confidence: /C6 Bank/i.test(t) ? 0.95 : 0.85,
    };
  },

  parse(text: string, ctx: { accountId: string }): ParsedStatement {
    const lines = normalize(text);
    let block: { from: string; to: string } | null = null;
    let accountRef: string | null = null;
    let period: ParsedStatement["period"] = null;
    const balances: BalancePoint[] = [];
    const raw: Array<{ date: string; postedDate: string; signed: number; description: string }> = [];

    for (const line of lines) {
      accountRef ??= line.match(ACCOUNT)?.[1] ?? null;

      const per = line.match(PERIOD);
      if (per) {
        const from = parsePtLongDate(per[1], per[2], per[3]);
        const to = parsePtLongDate(per[4], per[5], per[6]);
        if (from && to) period = { from, to };
        continue;
      }

      const exported = line.match(BALANCE_EXPORT);
      if (exported) {
        const dateISO = parsePtLongDate(exported[1], exported[2], exported[3]);
        const balanceCents = parseBrlCents(exported[4]);
        if (dateISO && balanceCents !== null) balances.push({ dateISO, balanceCents });
        continue;
      }

      const blockMatch = line.match(MONTH_BLOCK);
      if (blockMatch) {
        const from = toISODate(Number(blockMatch[3]), Number(blockMatch[2]), Number(blockMatch[1]));
        const to = toISODate(Number(blockMatch[6]), Number(blockMatch[5]), Number(blockMatch[4]));
        if (!from || !to) throw new StatementParseError(`período do mês inválido: "${line.slice(0, 60)}"`);
        block = { from, to };
        continue;
      }

      const day = line.match(BALANCE_DAY);
      if (day) {
        const dateISO = toISODate(2000 + Number(day[3]), Number(day[2]), Number(day[1]));
        const balanceCents = parseBrlCents(day[4]);
        if (!dateISO || balanceCents === null) throw new StatementParseError(`saldo do dia inválido: "${line}"`);
        balances.push({ dateISO, balanceCents });
        continue;
      }

      const cells = splitCells(line);
      const launched = cells.length === 5 ? DAY_MONTH.exec(cells[0]) : null;
      const posted = cells.length === 5 ? DAY_MONTH.exec(cells[1]) : null;
      if (!launched || !posted) continue;

      if (!block) throw new StatementParseError("lançamento encontrado antes do cabeçalho do mês");
      const cents = parseBrlCents(cells[4]);
      if (cents === null) throw new StatementParseError(`valor inválido: "${cells[4]}"`);
      const date = inferYearISO(Number(launched[1]), Number(launched[2]), block.from, block.to);
      const postedDate = inferYearISO(Number(posted[1]), Number(posted[2]), block.from, block.to);
      if (!date || !postedDate) throw new StatementParseError(`data inválida: "${cells[0]}" / "${cells[1]}"`);
      if (cents === 0) continue;
      raw.push({ date, postedDate, signed: cents, description: cells[3] });
    }

    if (raw.length === 0 && balances.length === 0) {
      throw new StatementParseError("nenhum lançamento ou saldo encontrado no extrato");
    }

    const fingerprints = ordinalFingerprints(
      raw.map((r) => importFingerprint(ctx.accountId, r.date, r.signed, r.description)),
    );
    const rows: ParsedRow[] = raw.map((r, i) => ({
      type: r.signed < 0 ? "expense" : "income",
      amountCents: Math.abs(r.signed),
      date: r.date,
      postedDate: r.postedDate,
      description: r.description,
      fingerprint: fingerprints[i],
    }));

    return { rows, balances, accountRef, period };
  },
};
```

- [x] **Step 6: Implementar o parser OFX e o registro**

Criar `packages/shared/src/parsers/ofx-statement.ts`:

```ts
import type { Institution } from "../enums";
import { importFingerprint, ordinalFingerprints } from "../import";
import { parseOfx } from "../ofx";
import {
  StatementParseError,
  type BalancePoint,
  type DetectResult,
  type ParsedRow,
  type ParsedStatement,
  type StatementParser,
} from "./types";

/** Códigos COMPE dos bancos que o sistema conhece. */
const BANK_BY_ID: Record<string, Institution> = {
  "001": "bb",
  "077": "inter",
  "336": "c6",
  "323": "mercado_pago",
};

const tagValue = (text: string, tag: string): string | null =>
  text.match(new RegExp(`<${tag}>\\s*([^<\\r\\n]+)`, "i"))?.[1].trim() ?? null;

function institutionOf(text: string): Institution {
  const id = tagValue(text, "BANKID");
  if (!id) return "other";
  return BANK_BY_ID[id.padStart(3, "0").slice(-3)] ?? "other";
}

export const ofxStatementParser: StatementParser = {
  id: "ofx",

  detect(text: string): DetectResult | null {
    if (!/<OFX>/i.test(text) && !/^\s*OFXHEADER:/i.test(text)) return null;
    const card = /<CCACCTFROM>/i.test(text);
    return {
      institution: institutionOf(text),
      kind: card ? "card_invoice" : "statement",
      format: "ofx",
      accountRef: tagValue(text, "ACCTID"),
      confidence: 0.95,
    };
  },

  parse(text: string, ctx: { accountId: string }): ParsedStatement {
    const txns = parseOfx(text);
    if (txns.length === 0) throw new StatementParseError("nenhuma transação encontrada no OFX");

    const base = txns.map((t) =>
      t.fitid ? null : importFingerprint(ctx.accountId, t.dateISO, t.amountCents, t.memo),
    );
    const ordinals = ordinalFingerprints(base.filter((k): k is string => k !== null));
    let next = 0;

    const rows: ParsedRow[] = txns.map((t, i) => ({
      type: t.amountCents < 0 ? "expense" : "income",
      amountCents: Math.abs(t.amountCents),
      date: t.dateISO,
      postedDate: null,
      description: t.memo,
      fingerprint: base[i] === null ? `ofx:${ctx.accountId}:${t.fitid}` : ordinals[next++],
    }));

    const balances: BalancePoint[] = [];
    const ledger = text.match(/<LEDGERBAL>[\s\S]*?<BALAMT>\s*([^<\r\n]+)[\s\S]*?<DTASOF>\s*(\d{8})/i);
    if (ledger) {
      const cents = Math.round(parseFloat(ledger[1].replace(",", ".")) * 100);
      const d = ledger[2];
      if (!Number.isNaN(cents)) balances.push({ dateISO: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, balanceCents: cents });
    }

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      balances,
      accountRef: tagValue(text, "ACCTID"),
      period: { from: dates[0], to: dates[dates.length - 1] },
    };
  },
};
```

Criar `packages/shared/src/parsers/index.ts`:

```ts
import { c6StatementParser } from "./c6-statement";
import { ofxStatementParser } from "./ofx-statement";
import type { DetectResult, StatementParser } from "./types";

export * from "./types";
export * from "./text";
export * from "./balance";
export { c6StatementParser, ofxStatementParser };

export const STATEMENT_PARSERS: StatementParser[] = [c6StatementParser, ofxStatementParser];

/** Parser de maior confiança para o texto; confiança abaixo de 0,5 conta como não reconhecido. */
export function detectStatement(text: string): { parser: StatementParser; detected: DetectResult } | null {
  let best: { parser: StatementParser; detected: DetectResult } | null = null;
  for (const parser of STATEMENT_PARSERS) {
    const detected = parser.detect(text);
    if (detected && (!best || detected.confidence > best.detected.confidence)) best = { parser, detected };
  }
  return best && best.detected.confidence >= 0.5 ? best : null;
}
```

Em `packages/shared/src/index.ts`, acrescentar antes da linha `// Mesma instância de ZodError…`:

```ts
export * from "./parsers";
```

- [x] **Step 7: Rodar testes e typecheck do monorepo**

```bash
pnpm --filter @app/shared test
pnpm turbo typecheck
```

Esperado: `@app/shared` com todos os testes passando (64 da Task 2 + 25 novos) e typecheck verde nos 4 pacotes. Se o typecheck da API acusar uso de `OfxTxn.fitid` como `string` (em `import.service.ts`, `ofxPreview`), ignorar: esse método é removido na Task 4 (nesse caso rode o typecheck só do shared agora e o monorepo na Task 4).

- [x] **Step 8: Commit**

```bash
git add packages/shared
git commit -m "$(cat <<'EOF'
feat(shared): parsers do extrato C6 (PDF) e OFX com detecção de banco/conta e fixture sintética

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: API — detecção, preview de extrato, commit e fingerprint sem falsos duplicados

**Files:**
- Modify: `apps/api/package.json` (dependência `pdf-parse`)
- Create: `apps/api/src/import/pdf-text.ts`
- Create: `apps/api/src/import/import-statement.service.ts`
- Modify: `apps/api/src/import/import.service.ts`
- Modify: `apps/api/src/import/import.controller.ts`
- Modify: `apps/api/src/import/import.module.ts`
- Modify: `apps/api/src/main.ts`
- Create: `apps/api/test/e2e/import-statements.e2e.test.ts`

**Interfaces:**
- Consumes (Tasks 2–3): `detectStatement`, `verifyBalances`, `StatementParseError`, `ordinalFingerprints`, `importFingerprint`, tipos; fixture `C6_SAMPLE`/`c6SampleText`.
- Produces:
  - `pdf-text.ts`: `isPdf(bytes: Uint8Array): boolean`, `extractPdfText(bytes: Uint8Array): Promise<string>`, `decodeText(bytes: Uint8Array): string` (UTF-8; se houver `U+FFFD`, windows-1252).
  - `POST /import/detect` body `{ fileName: string; contentBase64: string }` → `{ format: "ofx" | "pdf_statement" | "csv" | "pdf" | "unknown"; institution: Institution | null; kind: "statement" | "card_invoice" | null; accountRef: string | null; confidence: number; matchedAccountId: string | null; text: string | null }` (`text` só para `ofx` e `pdf_statement`).
  - `POST /import/preview` body `{ accountId: string; text: string; format: "ofx" | "pdf_statement" }` → `{ batchId; institution; accountRef; period; rows: Array<{ type; amountCents; date; postedDate; description; fingerprint; accountId; dup }>; rowCount; dupCount; balanceCheck: BalanceCheck | null }`; 404 se a conta não é do workspace; 422 se o texto não é reconhecido ou não interpretável.
  - `POST /import/:batchId/commit` passa a aceitar `postedDate?: string | null` por linha, valida que todas as contas pertencem ao workspace (400) e responde `{ inserted, skipped }`.
  - `POST /import/csv/preview` passa a usar fingerprint com ordinal e ainda reconhece duplicatas gravadas com a chave legada.
  - Removido: `POST /import/ofx/preview`.

- [x] **Step 1: Instalar `pdf-parse` na API**

```bash
pnpm --filter @app/api add pdf-parse@^2.4.5
git diff --stat apps/api/package.json pnpm-lock.yaml | tail -2
```

Esperado: `apps/api/package.json` ganha `"pdf-parse": "^2.4.5"` e o lockfile é atualizado.

- [x] **Step 2: Escrever os testes e2e (devem falhar)**

Criar `apps/api/test/e2e/import-statements.e2e.test.ts`:

```ts
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import { C6_SAMPLE, c6SampleText } from "../../../../packages/shared/src/parsers/__fixtures__/c6-sample";

// PDFs de verdade não podem ser gerados no teste: o extrator é simulado e devolve o texto pedido.
const pdfState = vi.hoisted(() => ({ text: "" }));
vi.mock("../../src/import/pdf-text", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/import/pdf-text")>();
  return { ...real, extractPdfText: async () => pdfState.text };
});

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

async function newAccount(u: User, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "POST", url: "/accounts", headers: u.h,
    payload: { type: "checking", name: "C6 PJ", entity: "pj", institution: "c6", ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64");
const PDF_BYTES = b64("%PDF-1.4\n% fake");

const post = (u: User, url: string, payload: unknown) => app.inject({ method: "POST", url, headers: u.h, payload: payload as object });

async function previewC6(u: User, accountId: string, text = c6SampleText()) {
  const res = await post(u, "/import/preview", { accountId, text, format: "pdf_statement" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function commitPayload(rows: Array<Record<string, unknown>>, accountId: string) {
  return {
    rows: rows.map((r) => ({
      type: r.type, amountCents: r.amountCents, date: r.date, postedDate: r.postedDate,
      description: r.description, fingerprint: r.fingerprint, accountId,
    })),
  };
}

/** Extrato C6 sintético mínimo: blocos mensais com linhas [lançamento, contábil, tipo, descrição, valor]. */
function c6Extract(blocks: Array<{ title: string; from: string; to: string; rows: string[][] }>): string {
  const cell = (...c: string[]) => c.join(" \t");
  return [
    "Extrato exportado no dia 30 de setembro de 2026 às 10:00",
    "FULANO DE TESTE • 000.000.000-00",
    `Agência: 1 • Conta: ${C6_SAMPLE.conta}`,
    "Saldo do dia • 30 de setembro de 2026 • R$ 0,00",
    ...blocks.flatMap((b) => [
      `${b.title} ( ${b.from} - ${b.to} ) \tEntradas: R$ 0,00 • Saídas: R$ 0,00`,
      "Data",
      "lançamento",
      "Data",
      cell("contábil", "Tipo", "Descrição", "Valor"),
      ...b.rows.map((r) => cell(...r)),
    ]),
  ].join("\n");
}

const MAIO = {
  title: "Maio 2026", from: "01/05/2026", to: "31/05/2026",
  rows: [
    ["10/05", "10/05", "Saída PIX", "Pix enviado para A", "-R$ 100,00"],
    ["10/05", "10/05", "Saída PIX", "Pix enviado para A", "-R$ 100,00"], // idêntica à anterior, mesmo dia
    ["20/05", "20/05", "Entrada PIX", "Pix recebido de B", "R$ 50,00"],
  ],
};
const JUNHO = {
  title: "Junho 2026", from: "01/06/2026", to: "30/06/2026",
  rows: [["15/06", "15/06", "Saída PIX", "Pix enviado para C", "-R$ 30,00"]],
};
const JULHO = {
  title: "Julho 2026", from: "01/07/2026", to: "31/07/2026",
  rows: [["05/07", "05/07", "Saída PIX", "Pix enviado para D", "-R$ 10,00"]],
};
/** Dois extratos de períodos que se sobrepõem (maio e junho nos dois): o segundo só acrescenta julho. */
const OVERLAP_A = c6Extract([MAIO, JUNHO]);
const OVERLAP_B = c6Extract([MAIO, JUNHO, JULHO]);

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>077<ACCTID>555-1</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260605<TRNAMT>-35.00<FITID>F1<MEMO>Padaria São João</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260610<TRNAMT>100.00<FITID>F2<MEMO>Pix recebido</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe("Fase 11 — POST /import/detect", () => {
  it("reconhece OFX Latin-1 (bytes), banco pelo BANKID e conta cadastrada pelo externalId", async () => {
    const u = await newUser("det1");
    const accountId = await newAccount(u, { institution: "inter", externalId: "555-1" });
    const res = await post(u, "/import/detect", { fileName: "extrato.ofx", contentBase64: b64(Buffer.from(OFX, "latin1")) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      format: "ofx", institution: "inter", kind: "statement", accountRef: "555-1", matchedAccountId: accountId,
    });
    expect(body.text).toContain("Padaria São João");
  });

  it("OFX sem conta cadastrada com aquele número não sugere conta", async () => {
    const u = await newUser("det2");
    await newAccount(u, { externalId: "outra" });
    const res = await post(u, "/import/detect", { fileName: "x.ofx", contentBase64: b64(OFX) });
    expect(res.json().matchedAccountId).toBeNull();
  });

  it("duas contas com o mesmo número: ambíguo, não sugere", async () => {
    const u = await newUser("det3");
    await newAccount(u, { externalId: "555-1", name: "A" });
    await newAccount(u, { externalId: "555-1", name: "B" });
    const res = await post(u, "/import/detect", { fileName: "x.ofx", contentBase64: b64(OFX) });
    expect(res.json().matchedAccountId).toBeNull();
  });

  it("PDF do C6: extrai o texto e reconhece o extrato e a conta", async () => {
    const u = await newUser("det4");
    const accountId = await newAccount(u, { externalId: C6_SAMPLE.conta });
    pdfState.text = c6SampleText();
    const res = await post(u, "/import/detect", { fileName: "Extrato.pdf", contentBase64: PDF_BYTES });
    expect(res.json()).toMatchObject({
      format: "pdf_statement", institution: "c6", kind: "statement", accountRef: C6_SAMPLE.conta, matchedAccountId: accountId,
    });
    expect(res.json().text).toContain("Saldo do dia");
  });

  it("PDF de banco desconhecido: format pdf (caminho de IA), sem texto devolvido", async () => {
    const u = await newUser("det5");
    pdfState.text = "Compra Netflix 15/06/2026 R$ 55,90";
    const res = await post(u, "/import/detect", { fileName: "fatura.pdf", contentBase64: PDF_BYTES });
    expect(res.json()).toMatchObject({ format: "pdf", institution: null, text: null, matchedAccountId: null });
  });

  it("CSV e arquivo desconhecido", async () => {
    const u = await newUser("det6");
    const csv = await post(u, "/import/detect", { fileName: "mov.csv", contentBase64: b64("Data,Valor,Descricao\n01/06/2026,-10,x\n") });
    expect(csv.json().format).toBe("csv");
    const unk = await post(u, "/import/detect", { fileName: "foto.bin", contentBase64: b64("oi") });
    expect(unk.json().format).toBe("unknown");
  });

  it("arquivo vazio ou base64 ausente retornam 400", async () => {
    const u = await newUser("det7");
    expect((await post(u, "/import/detect", { fileName: "a.ofx", contentBase64: "" })).statusCode).toBe(400);
    expect((await post(u, "/import/detect", { fileName: "a.ofx" })).statusCode).toBe(400);
  });
});

describe("Fase 11 — POST /import/preview e commit (extrato C6)", () => {
  it("preview traz linhas, batch com instituição/conta detectada e saldos conferidos", async () => {
    const u = await newUser("prev1");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId);

    expect(body).toMatchObject({ institution: "c6", accountRef: C6_SAMPLE.conta, rowCount: C6_SAMPLE.rowCount, dupCount: 0 });
    expect(body.period).toEqual(C6_SAMPLE.period);
    expect(body.balanceCheck).toMatchObject({ ok: true, checkpoints: C6_SAMPLE.checkpoints, mismatches: [] });
    expect(body.rows[0]).toMatchObject({ type: "income", amountCents: 100000, date: "2025-10-02", accountId, dup: false });

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: body.batchId } });
    expect(batch).toMatchObject({
      format: "pdf_statement", institution: "c6", detectedAccountRef: C6_SAMPLE.conta, status: "preview", rowCount: 9, dupCount: 0,
    });
    expect((batch.balanceCheck as { ok: boolean }).ok).toBe(true);
  });

  it("commit grava as 9 linhas, inclusive as duas idênticas no mesmo dia, e a data contábil", async () => {
    const u = await newUser("prev2");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId);
    const res = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inserted: 9, skipped: 0 });

    const padarias = await prisma.transaction.count({ where: { workspaceId: u.workspaceId, description: "Pix enviado para Padaria" } });
    expect(padarias).toBe(2);
    const fatura = await prisma.transaction.findFirstOrThrow({ where: { workspaceId: u.workspaceId, description: "PGTO FAT CARTAO C6" } });
    expect(fatura.date.toISOString().slice(0, 10)).toBe("2025-10-29");
    expect(fatura.postedDate?.toISOString().slice(0, 10)).toBe("2025-11-01");
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: body.batchId } })).status).toBe("committed");
  });

  it("reimportar o mesmo arquivo marca tudo como duplicata e não insere nada", async () => {
    const u = await newUser("prev3");
    const accountId = await newAccount(u);
    const first = await previewC6(u, accountId);
    await post(u, `/import/${first.batchId}/commit`, commitPayload(first.rows, accountId));

    const second = await previewC6(u, accountId);
    expect(second.dupCount).toBe(9);
    expect(second.rows.every((r: { dup: boolean }) => r.dup)).toBe(true);

    const res = await post(u, `/import/${second.batchId}/commit`, commitPayload(second.rows, accountId));
    expect(res.json()).toEqual({ inserted: 0, skipped: 9 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(9);
  });

  it("saldo errado no arquivo vira divergência no preview, sem bloquear", async () => {
    const u = await newUser("prev4");
    const accountId = await newAccount(u);
    const body = await previewC6(u, accountId, c6SampleText({ corruptBalance: true }));
    expect(body.balanceCheck.ok).toBe(false);
    expect(body.balanceCheck.mismatches.map((m: { dateISO: string; diffCents: number }) => [m.dateISO, m.diffCents])).toEqual([
      ["2025-10-29", 950],
      ["2025-11-03", -950],
    ]);
    expect(body.rowCount).toBe(9);
  });

  it("texto não reconhecido retorna 422; conta de outro workspace retorna 404", async () => {
    const a = await newUser("prev5a");
    const b = await newUser("prev5b");
    const accountA = await newAccount(a);
    expect((await post(a, "/import/preview", { accountId: accountA, text: "texto qualquer", format: "pdf_statement" })).statusCode).toBe(422);
    expect((await post(b, "/import/preview", { accountId: accountA, text: c6SampleText(), format: "pdf_statement" })).statusCode).toBe(404);
  });

  it("OFX: preview usa ofx:{conta}:{FITID} e detecta duplicata depois do commit", async () => {
    const u = await newUser("prev6");
    const accountId = await newAccount(u, { institution: "inter" });
    const first = await post(u, "/import/preview", { accountId, text: OFX, format: "ofx" });
    expect(first.statusCode).toBe(200);
    expect(first.json().rows.map((r: { fingerprint: string }) => r.fingerprint)).toEqual([`ofx:${accountId}:F1`, `ofx:${accountId}:F2`]);
    expect(first.json().balanceCheck).toBeNull();

    await post(u, `/import/${first.json().batchId}/commit`, commitPayload(first.json().rows, accountId));
    const second = await post(u, "/import/preview", { accountId, text: OFX, format: "ofx" });
    expect(second.json().dupCount).toBe(2);
  });

  it("commit recusa linhas com conta de outro workspace (400)", async () => {
    const a = await newUser("prev7a");
    const b = await newUser("prev7b");
    const accountA = await newAccount(a);
    const accountB = await newAccount(b);
    const body = await previewC6(b, accountB);
    const res = await post(b, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountA));
    expect(res.statusCode).toBe(400);
    expect(await prisma.transaction.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
  });
});

describe("Fase 11 — extratos com períodos sobrepostos", () => {
  const dups = (rows: Array<{ dup: boolean }>) => rows.map((r) => r.dup);

  it("o segundo extrato só acrescenta o que é novo: não sobrescreve nem duplica", async () => {
    const u = await newUser("ovl1");
    const accountId = await newAccount(u);

    const a = await previewC6(u, accountId, OVERLAP_A);
    expect(a.rowCount).toBe(4);
    await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));

    const b = await previewC6(u, accountId, OVERLAP_B);
    expect(b.rowCount).toBe(5);
    expect(b.dupCount).toBe(4);
    expect(dups(b.rows)).toEqual([true, true, true, true, false]);

    const res = await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));
    expect(res.json()).toEqual({ inserted: 1, skipped: 4 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(5);
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId, description: "Pix enviado para A" } })).toBe(2);
  });

  it("a ordem de importação não importa: o extrato maior primeiro torna o menor 100% duplicado", async () => {
    const u = await newUser("ovl2");
    const accountId = await newAccount(u);
    const b = await previewC6(u, accountId, OVERLAP_B);
    await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));

    const a = await previewC6(u, accountId, OVERLAP_A);
    expect(a.dupCount).toBe(4);
    const res = await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));
    expect(res.json()).toEqual({ inserted: 0, skipped: 4 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(5);
  });

  it("a categoria ajustada depois da 1ª importação sobrevive ao 2º extrato", async () => {
    const u = await newUser("ovl3");
    const accountId = await newAccount(u);
    const a = await previewC6(u, accountId, OVERLAP_A);
    await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));

    const category = await prisma.category.findFirstOrThrow({ where: { workspaceId: u.workspaceId, type: "income" } });
    const before = await prisma.transaction.findFirstOrThrow({ where: { workspaceId: u.workspaceId, description: "Pix recebido de B" } });
    await prisma.transaction.update({ where: { id: before.id }, data: { categoryId: category.id } });

    const b = await previewC6(u, accountId, OVERLAP_B);
    await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.categoryId).toBe(category.id);
    expect(after.importBatchId).toBe(a.batchId); // a linha continua pertencendo ao primeiro lote
  });
});

describe("Fase 11 — CSV com fingerprint por ordinal e compatibilidade com o legado", () => {
  const MAPPING = {
    dateColumn: "Data", amountColumn: "Valor", descriptionColumn: "Descricao",
    dateFormat: "DD/MM/YYYY", decimalSeparator: ".", expenseIsNegative: true,
  };
  const CSV = "Data,Valor,Descricao\n05/06/2026,-35.00,iFood\n05/06/2026,-35.00,iFood\n10/06/2026,1000.00,Salário";

  it("duas linhas idênticas no mesmo dia são as duas importadas", async () => {
    const u = await newUser("csv1");
    const accountId = await newAccount(u);
    const pre = await post(u, "/import/csv/preview", { accountId, mapping: MAPPING, csv: CSV });
    expect(pre.json()).toMatchObject({ rowCount: 3, dupCount: 0 });
    const fps = pre.json().rows.map((r: { fingerprint: string }) => r.fingerprint);
    expect(new Set(fps).size).toBe(3);

    const commit = await post(u, `/import/${pre.json().batchId}/commit`, commitPayload(pre.json().rows, accountId));
    expect(commit.json()).toEqual({ inserted: 3, skipped: 0 });

    const again = await post(u, "/import/csv/preview", { accountId, mapping: MAPPING, csv: CSV });
    expect(again.json().dupCount).toBe(3);
  });

  it("transação gravada com a chave legada (sem ordinal) ainda marca a primeira linha como duplicata", async () => {
    const u = await newUser("csv2");
    const accountId = await newAccount(u);
    await prisma.transaction.create({
      data: {
        workspaceId: u.workspaceId, type: "expense", amountCents: 3500n, date: new Date("2026-06-05"), accountId,
        source: "import", createdById: u.userId, importFingerprint: `${accountId}|2026-06-05|-3500|ifood`,
      },
    });
    const pre = await post(u, "/import/csv/preview", { accountId, mapping: MAPPING, csv: CSV });
    const dups = pre.json().rows.map((r: { dup: boolean }) => r.dup);
    expect(dups).toEqual([true, false, false]);
  });
});
```

- [x] **Step 3: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/import-statements.e2e.test.ts
```

Esperado: FAIL (rotas `/import/detect` e `/import/preview` inexistentes → 404; o módulo `pdf-text` também não existe, então a suíte pode falhar já no `vi.mock`; em ambos os casos é o vermelho esperado).

- [x] **Step 4: Criar `pdf-text.ts`**

```ts
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

/** Texto da camada de texto do PDF, com colunas separadas por tabulação (formato do pdf-parse). */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

/** UTF-8; se o arquivo não for UTF-8 válido (OFX de banco costuma ser Latin-1/CP-1252), decodifica como windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}
```

- [x] **Step 5: Criar `import-statement.service.ts` (detect e preview)**

```ts
import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import {
  detectStatement,
  StatementParseError,
  verifyBalances,
  type Institution,
  type StatementFormat,
  type StatementKind,
} from "@app/shared";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../database";
import { decodeText, extractPdfText, isPdf } from "./pdf-text";

export type DetectedFormat = StatementFormat | "csv" | "pdf" | "unknown";

export interface DetectResponse {
  format: DetectedFormat;
  institution: Institution | null;
  kind: StatementKind | null;
  accountRef: string | null;
  confidence: number;
  matchedAccountId: string | null;
  /** Texto extraído; só para formatos que o preview de extrato aceita (ofx e pdf_statement). */
  text: string | null;
}

const NOT_DETECTED = { institution: null, kind: null, accountRef: null, confidence: 0, matchedAccountId: null, text: null };

function looksLikeCsv(fileName: string, text: string): boolean {
  if (/\.csv$/i.test(fileName)) return true;
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.length >= 2 && lines[0].split(/[;,]/).length >= 3;
}

@Injectable()
export class ImportStatementService {
  async detect(workspaceId: string, input: { fileName: string; contentBase64: string }): Promise<DetectResponse> {
    const bytes = new Uint8Array(Buffer.from(input.contentBase64, "base64"));
    if (bytes.length === 0) throw new BadRequestException("arquivo vazio");

    const pdf = isPdf(bytes);
    let text: string;
    if (pdf) {
      try {
        text = await extractPdfText(bytes);
      } catch {
        throw new UnprocessableEntityException("não consegui ler o PDF");
      }
    } else {
      text = decodeText(bytes);
    }

    const hit = detectStatement(text);
    if (hit) {
      const { detected } = hit;
      return {
        format: detected.format,
        institution: detected.institution,
        kind: detected.kind,
        accountRef: detected.accountRef,
        confidence: detected.confidence,
        matchedAccountId: await this.matchAccount(workspaceId, detected.accountRef),
        text,
      };
    }
    if (pdf) return { format: "pdf", ...NOT_DETECTED };
    if (looksLikeCsv(input.fileName, text)) return { format: "csv", ...NOT_DETECTED };
    return { format: "unknown", ...NOT_DETECTED };
  }

  /** Conta ativa cujo externalId é o número lido no arquivo; ambíguo (mais de uma) não sugere nada. */
  private async matchAccount(workspaceId: string, accountRef: string | null): Promise<string | null> {
    if (!accountRef) return null;
    const accounts = await prisma.bankAccount.findMany({
      where: { workspaceId, archived: false, externalId: accountRef },
      select: { id: true },
    });
    return accounts.length === 1 ? accounts[0].id : null;
  }

  async preview(
    workspaceId: string,
    userId: string,
    input: { accountId: string; text: string; format: StatementFormat },
  ) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: input.accountId, workspaceId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("conta não encontrada");

    const hit = detectStatement(input.text);
    if (!hit) throw new UnprocessableEntityException("não reconheci o formato do extrato");

    let parsed;
    try {
      parsed = hit.parser.parse(input.text, { accountId: account.id });
    } catch (err) {
      if (err instanceof StatementParseError) throw new UnprocessableEntityException(err.message);
      throw err;
    }

    const existing = await prisma.transaction.findMany({
      where: { workspaceId, importFingerprint: { in: parsed.rows.map((r) => r.fingerprint) } },
      select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));
    const rows = parsed.rows.map((r) => ({ ...r, accountId: account.id, dup: seen.has(r.fingerprint) }));
    const dupCount = rows.filter((r) => r.dup).length;
    const balanceCheck = verifyBalances(parsed.rows, parsed.balances);

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId: account.id,
        format: hit.detected.format,
        institution: hit.detected.institution,
        detectedAccountRef: parsed.accountRef,
        balanceCheck: balanceCheck ? (balanceCheck as unknown as Prisma.InputJsonValue) : undefined,
        status: "preview",
        rowCount: rows.length,
        dupCount,
        createdById: userId,
      },
      select: { id: true },
    });

    return {
      batchId: batch.id,
      institution: hit.detected.institution,
      accountRef: parsed.accountRef,
      period: parsed.period,
      rows,
      rowCount: rows.length,
      dupCount,
      balanceCheck,
    };
  }
}
```

- [x] **Step 6: Atualizar `import.service.ts` (CSV com ordinal, commit com `postedDate`/`skipped`/validação de contas, remover OFX antigo)**

Em `apps/api/src/import/import.service.ts`:

1. Trocar a linha de import de `@app/shared` por:

```ts
import { csvMappingSchema, csvRowToTransaction, ordinalFingerprints } from "@app/shared";
```

2. Substituir o método `csvPreview` inteiro por:

```ts
  async csvPreview(
    workspaceId: string,
    userId: string,
    accountId: string,
    mappingRaw: unknown,
    csv: string,
  ) {
    const mapping = csvMappingSchema.parse(mappingRaw);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const txs = parsed.data.map((r) => csvRowToTransaction(r, mapping, accountId));

    // `fingerprint` de csvRowToTransaction é a chave base (formato legado); o ordinal separa linhas idênticas.
    const legacyKeys = txs.map((t) => t.fingerprint);
    const fingerprints = ordinalFingerprints(legacyKeys);
    const existing = await prisma.transaction.findMany({
      where: { workspaceId, importFingerprint: { in: [...fingerprints, ...legacyKeys] } },
      select: { importFingerprint: true },
    });
    const seen = new Set(existing.map((e) => e.importFingerprint));

    const rows = txs.map((t, i) => {
      const isFirstOfKey = fingerprints[i].endsWith("|0");
      return {
        ...t,
        fingerprint: fingerprints[i],
        // importações antigas gravaram só a chave base (e descartaram as repetidas): ela vale para a 1ª ocorrência
        dup: seen.has(fingerprints[i]) || (isFirstOfKey && seen.has(legacyKeys[i])),
      };
    });
    const dupCount = rows.filter((r) => r.dup).length;

    const batch = await prisma.importBatch.create({
      data: {
        workspaceId,
        accountId,
        format: "csv",
        status: "preview",
        rowCount: rows.length,
        dupCount,
        createdById: userId,
      },
      select: { id: true },
    });

    return { batchId: batch.id, rows, rowCount: rows.length, dupCount };
  }
```

3. **Remover** o método `ofxPreview` inteiro.

4. Substituir o método `commit` inteiro por:

```ts
  async commit(
    workspaceId: string,
    userId: string,
    batchId: string,
    rows: Array<{
      type: "income" | "expense";
      amountCents: number;
      date: string;
      postedDate?: string | null;
      accountId: string;
      description: string | null;
      categoryId?: string | null;
      fingerprint: string;
    }>,
  ) {
    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, workspaceId },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException("lote não encontrado");

    const accountIds = [...new Set(rows.map((r) => r.accountId))];
    const owned = await prisma.bankAccount.count({ where: { id: { in: accountIds }, workspaceId } });
    if (owned !== accountIds.length) throw new BadRequestException("conta inexistente no workspace");

    const payload = rows.map((r) => ({
      workspaceId,
      type: r.type,
      amountCents: BigInt(r.amountCents),
      date: new Date(r.date),
      postedDate: r.postedDate ? new Date(r.postedDate) : null,
      accountId: r.accountId,
      categoryId: r.categoryId ?? null,
      description: r.description,
      source: "import",
      importFingerprint: r.fingerprint,
      importBatchId: batchId,
      createdById: userId,
    }));

    const { count: inserted } = await prisma.transaction.createMany({ data: payload, skipDuplicates: true });

    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: "committed" },
    });

    if (inserted > 0) {
      try {
        await this.transactions.enqueueCategorizationJob(workspaceId, userId, batchId);
      } catch (err) {
        // categorização é enriquecimento assíncrono; falha aqui não invalida a importação já gravada
        console.error("[import] falha ao enfileirar categorização do lote", batchId, err);
      }
    }

    return { inserted, skipped: rows.length - inserted };
  }
```

5. Acrescentar `BadRequestException` ao import de `@nestjs/common` do topo do arquivo:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
```

- [x] **Step 7: Controller, módulo e limite de corpo**

Substituir `apps/api/src/import/import.controller.ts` por:

```ts
import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, type AuthenticatedUser } from "../auth/current-user.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { ImportService } from "./import.service";
import { ImportStatementService } from "./import-statement.service";

const detectBody = z.object({ fileName: z.string().min(1), contentBase64: z.string().min(1) });
const previewBody = z.object({
  accountId: z.string().min(1),
  text: z.string().min(1),
  format: z.enum(["ofx", "pdf_statement"]),
});

@Controller("import")
@UseGuards(CurrentUserGuard)
export class ImportController {
  constructor(
    private readonly service: ImportService,
    private readonly statements: ImportStatementService,
  ) {}

  @Post("detect")
  @HttpCode(200)
  detect(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.statements.detect(user.workspaceId, detectBody.parse(body));
  }

  @Post("preview")
  @HttpCode(200)
  preview(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.statements.preview(user.workspaceId, user.id, previewBody.parse(body));
  }

  @Post("csv/preview")
  @HttpCode(200)
  csvPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { accountId: string; mapping: unknown; csv: string },
  ) {
    return this.service.csvPreview(user.workspaceId, user.id, body.accountId, body.mapping, body.csv);
  }

  @Post(":batchId/commit")
  @HttpCode(200)
  commit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("batchId") batchId: string,
    @Body() body: { rows: Array<{ type: string; amountCents: number; date: string; postedDate?: string | null; accountId: string; description: string | null; fingerprint: string; categoryId?: string | null }> },
  ) {
    return this.service.commit(user.workspaceId, user.id, batchId, body.rows as Parameters<ImportService["commit"]>[3]);
  }

  @Post("pdf")
  @HttpCode(201)
  enqueuePdf(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { storagePath: string },
  ) {
    return this.service.enqueuePdf(user.workspaceId, user.id, body.storagePath);
  }

  @Get("mappings")
  listMappings(@CurrentUser() user: AuthenticatedUser) {
    return this.service.listMappings(user.workspaceId);
  }

  @Post("mappings")
  @HttpCode(201)
  saveMapping(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { name: string; format: "csv" | "ofx" | "pdf"; mapping: unknown },
  ) {
    return this.service.saveMapping(user.workspaceId, body.name, body.format, body.mapping);
  }
}
```

Em `apps/api/src/import/import.module.ts`, registrar o novo service. Ler o arquivo atual e acrescentar `ImportStatementService` ao array `providers` (e o import correspondente), mantendo o restante como está.

Em `apps/api/src/main.ts`, trocar a criação do app para subir o limite de corpo (PDF em base64 passa de 1 MB):

```ts
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 20 * 1024 * 1024 }),
  );
```

- [x] **Step 8: Rodar os testes e o typecheck**

```bash
pnpm --filter @app/api exec vitest run test/e2e/import-statements.e2e.test.ts test/e2e/import.e2e.test.ts
pnpm --filter @app/api typecheck
```

Esperado: todos passam (os 19 novos e os 4 antigos de `import.e2e.test.ts`, que continuam válidos) e typecheck verde. Se `import.e2e.test.ts` (TM2/TM3) quebrar por causa do novo formato de fingerprint no CSV, os testes devem ser ajustados só onde comparam a string do fingerprint; o comportamento (idempotência e `dupCount` após commit) deve permanecer.

- [x] **Step 9: Suíte completa da API**

```bash
pnpm --filter @app/api test
```

Esperado: todos os arquivos passam.

- [x] **Step 10: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(api): detecção de arquivo, preview de extrato com conferência de saldo e fingerprint por ordinal

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: API — desfazer lote, histórico e aceite com os extratos reais

**Files:**
- Modify: `apps/api/src/import/import-statement.service.ts` (métodos `undo` e `listBatches`)
- Modify: `apps/api/src/import/import.controller.ts` (rotas)
- Modify: `apps/api/test/e2e/import-statements.e2e.test.ts` (novo `describe`)
- Create: `apps/api/test/e2e/import-real-statements.test.ts`

**Interfaces:**
- Consumes (Task 4): `previewC6`, `commitPayload`, `newUser`, `newAccount`, `post` (helpers do arquivo de teste), `ImportStatementService`.
- Produces:
  - `POST /import/:batchId/undo` → `{ removed: number }`; 404 se o lote não é do workspace; 409 se o lote não foi confirmado ou já foi desfeito. Apaga as transações do lote e grava `undoneAt`.
  - `GET /import/batches` → `Array<{ id; format; institution; accountName: string | null; rowCount; dupCount; inserted; balanceOk: boolean | null; createdAt; undoneAt: string | null }>`, só lotes confirmados, mais recentes primeiro, no máximo 50.

- [x] **Step 1: Escrever os testes (devem falhar)**

Acrescentar ao final de `apps/api/test/e2e/import-statements.e2e.test.ts`:

```ts
describe("Fase 11 — desfazer lote e histórico", () => {
  async function importC6(u: User, accountId: string) {
    const body = await previewC6(u, accountId);
    const commit = await post(u, `/import/${body.batchId}/commit`, commitPayload(body.rows, accountId));
    expect(commit.json().inserted).toBe(9);
    return body.batchId as string;
  }

  it("undo apaga as transações do lote, marca undoneAt e libera a reimportação", async () => {
    const u = await newUser("undo1");
    const accountId = await newAccount(u);
    const batchId = await importC6(u, accountId);

    const res = await post(u, `/import/${batchId}/undo`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removed: 9 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(0);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } })).undoneAt).not.toBeNull();

    const again = await previewC6(u, accountId);
    expect(again.dupCount).toBe(0);
  });

  it("undo só mexe nas transações do próprio lote", async () => {
    const u = await newUser("undo2");
    const accountId = await newAccount(u);
    await prisma.transaction.create({
      data: { workspaceId: u.workspaceId, type: "expense", amountCents: 100n, date: new Date("2026-01-01"), accountId, source: "manual", createdById: u.userId },
    });
    const batchId = await importC6(u, accountId);
    await post(u, `/import/${batchId}/undo`, {});
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(1);
  });

  it("undo duas vezes retorna 409; lote só em preview retorna 409; lote de outro workspace retorna 404", async () => {
    const a = await newUser("undo3a");
    const b = await newUser("undo3b");
    const accountId = await newAccount(a);
    const batchId = await importC6(a, accountId);
    expect((await post(a, `/import/${batchId}/undo`, {})).statusCode).toBe(200);
    expect((await post(a, `/import/${batchId}/undo`, {})).statusCode).toBe(409);

    const previewOnly = await previewC6(a, accountId);
    expect((await post(a, `/import/${previewOnly.batchId}/undo`, {})).statusCode).toBe(409);

    const other = await importC6(a, accountId);
    expect((await post(b, `/import/${other}/undo`, {})).statusCode).toBe(404);
  });

  it("desfazer o lote do extrato sobreposto remove só as linhas que ele inseriu", async () => {
    const u = await newUser("undo4");
    const accountId = await newAccount(u);
    const a = await previewC6(u, accountId, OVERLAP_A);
    await post(u, `/import/${a.batchId}/commit`, commitPayload(a.rows, accountId));
    const b = await previewC6(u, accountId, OVERLAP_B);
    await post(u, `/import/${b.batchId}/commit`, commitPayload(b.rows, accountId));
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(5);

    const res = await post(u, `/import/${b.batchId}/undo`, {});
    expect(res.json()).toEqual({ removed: 1 });
    expect(await prisma.transaction.count({ where: { workspaceId: u.workspaceId } })).toBe(4);
  });

  it("GET /import/batches lista só lotes confirmados, com contagem real, saldo e estado de desfeito", async () => {
    const u = await newUser("hist1");
    const accountId = await newAccount(u, { name: "C6 Empresa" });
    await previewC6(u, accountId); // só preview: não aparece
    const batchId = await importC6(u, accountId);

    let list = (await app.inject({ method: "GET", url: "/import/batches", headers: u.h })).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: batchId, format: "pdf_statement", institution: "c6", accountName: "C6 Empresa",
      rowCount: 9, inserted: 9, balanceOk: true, undoneAt: null,
    });

    await post(u, `/import/${batchId}/undo`, {});
    list = (await app.inject({ method: "GET", url: "/import/batches", headers: u.h })).json();
    expect(list[0]).toMatchObject({ id: batchId, inserted: 0 });
    expect(list[0].undoneAt).not.toBeNull();
  });

  it("GET /import/batches é isolado por workspace", async () => {
    const a = await newUser("hist2a");
    const b = await newUser("hist2b");
    await importC6(a, await newAccount(a));
    const list = (await app.inject({ method: "GET", url: "/import/batches", headers: b.h })).json();
    expect(list).toEqual([]);
  });
});
```

Criar `apps/api/test/e2e/import-real-statements.test.ts` (aceite com os extratos reais; só roda onde os PDFs existem e nunca imprime conteúdo):

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { detectStatement, verifyBalances } from "@app/shared";
import { extractPdfText } from "../../src/import/pdf-text";

const FILES = {
  PF: join(homedir(), "Downloads", "Extrato C6 Bank PF.pdf"),
  PJ: join(homedir(), "Downloads", "Extrato C6 Bank PJ.pdf"),
};

describe.each(Object.entries(FILES))("extrato C6 real (%s)", (label, path) => {
  it.skipIf(!existsSync(path))("é reconhecido como C6 e os saldos declarados fecham", async () => {
    const text = await extractPdfText(new Uint8Array(readFileSync(path)));
    const hit = detectStatement(text);
    expect(hit?.detected).toMatchObject({ institution: "c6", kind: "statement", format: "pdf_statement" });
    expect(hit?.detected.accountRef).toMatch(/^\d+$/);

    const parsed = hit!.parser.parse(text, { accountId: `real-${label}` });
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(new Set(parsed.rows.map((r) => r.fingerprint)).size).toBe(parsed.rows.length);

    const check = verifyBalances(parsed.rows, parsed.balances);
    expect(check).not.toBeNull();
    expect(check!.checkpoints).toBeGreaterThan(10);
    expect(check!.mismatches).toEqual([]);
    expect(check!.ok).toBe(true);
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/api exec vitest run test/e2e/import-statements.e2e.test.ts -t "desfazer lote"
```

Esperado: FAIL (404 nas rotas `undo` e `batches`). O teste dos PDFs reais passa por si só (ele só usa código das tasks anteriores); rode-o também:

```bash
pnpm --filter @app/api exec vitest run test/e2e/import-real-statements.test.ts
```

Esperado: 2 testes passam onde os PDFs existem (na sua máquina) ou 2 ignorados (`skipped`) onde não existem.

- [x] **Step 3: Implementar `undo` e `listBatches`**

Em `apps/api/src/import/import-statement.service.ts`, acrescentar `ConflictException` ao import de `@nestjs/common`:

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
```

e acrescentar, dentro da classe `ImportStatementService` (depois do método `preview`):

```ts
  /** Apaga as transações do lote e registra `undoneAt`. O lote precisa estar confirmado e ainda não desfeito. */
  async undo(workspaceId: string, batchId: string) {
    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, workspaceId },
      select: { status: true, undoneAt: true },
    });
    if (!batch) throw new NotFoundException("lote não encontrado");
    if (batch.status !== "committed") throw new ConflictException("o lote ainda não foi confirmado");
    if (batch.undoneAt) throw new ConflictException("o lote já foi desfeito");

    const [removed] = await prisma.$transaction([
      prisma.transaction.deleteMany({ where: { workspaceId, importBatchId: batchId } }),
      prisma.importBatch.update({ where: { id: batchId }, data: { undoneAt: new Date() } }),
    ]);
    return { removed: removed.count };
  }

  async listBatches(workspaceId: string) {
    const batches = await prisma.importBatch.findMany({
      where: { workspaceId, status: "committed" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        format: true,
        institution: true,
        rowCount: true,
        dupCount: true,
        balanceCheck: true,
        createdAt: true,
        undoneAt: true,
        account: { select: { name: true } },
        _count: { select: { transactions: true } },
      },
    });
    return batches.map((b) => ({
      id: b.id,
      format: b.format,
      institution: b.institution,
      accountName: b.account?.name ?? null,
      rowCount: b.rowCount,
      dupCount: b.dupCount,
      inserted: b._count.transactions,
      balanceOk: b.balanceCheck ? (b.balanceCheck as { ok: boolean }).ok : null,
      createdAt: b.createdAt,
      undoneAt: b.undoneAt,
    }));
  }
```

Em `apps/api/src/import/import.controller.ts`, acrescentar as rotas (as estáticas `batches` e `mappings` não conflitam com `:batchId/...`). Depois do método `commit`:

```ts
  @Post(":batchId/undo")
  @HttpCode(200)
  undo(@CurrentUser() user: AuthenticatedUser, @Param("batchId") batchId: string) {
    return this.statements.undo(user.workspaceId, batchId);
  }

  @Get("batches")
  listBatches(@CurrentUser() user: AuthenticatedUser) {
    return this.statements.listBatches(user.workspaceId);
  }
```

- [x] **Step 4: Rodar os testes e o typecheck**

```bash
pnpm --filter @app/api exec vitest run test/e2e/import-statements.e2e.test.ts test/e2e/import-real-statements.test.ts
pnpm --filter @app/api typecheck
pnpm --filter @app/api test
```

Esperado: tudo verde (6 testes novos de desfazer/histórico; o de PDFs reais passa ou é ignorado).

- [x] **Step 5: Commit**

```bash
git add apps/api
git commit -m "$(cat <<'EOF'
feat(api): desfazer lote de importação, histórico de lotes e aceite com os extratos C6 reais

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Front — tela de importação com detecção automática, conferência de saldo, histórico e desfazer

**Files:**
- Create: `apps/web/src/lib/import-client.ts`
- Create: `apps/web/src/lib/__tests__/import-client.test.ts`
- Modify (reescrever): `apps/web/src/views/ImportView.vue`

**Interfaces:**
- Consumes: contrato da API da Task 4 e 5; `INSTITUTION_LABEL`, `Institution` de `lib/entity.ts`; `store.updateAccount`, `store.loadAccounts`; `http` de `lib/http.ts`.
- Produces (`lib/import-client.ts`): `DetectedFormat`, `DetectResponse`, `BalanceMismatch`, `BalanceCheck`, `PreviewRow`, `StatementPreview`, `BatchSummary`, `bytesToBase64(bytes: Uint8Array): string`, `fileToBase64(file: File): Promise<string>`, `balanceSummary(check: BalanceCheck | null): { tone: "neutral" | "ok" | "warn"; text: string }`, `detectFile(file: File): Promise<DetectResponse>`, `previewStatement(body): Promise<StatementPreview>`, `undoBatch(batchId): Promise<{ removed: number }>`, `listBatches(): Promise<BatchSummary[]>`.

- [x] **Step 1: Escrever os testes dos helpers (devem falhar)**

Criar `apps/web/src/lib/__tests__/import-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../http", () => ({ http: vi.fn(async () => ({})) }));

import { http } from "../http";
import { bytesToBase64, fileToBase64, balanceSummary, detectFile, previewStatement, undoBatch, listBatches } from "../import-client";

const lastCall = () => {
  const calls = vi.mocked(http).mock.calls;
  return (calls[calls.length - 1] ?? []).slice(0, 3);
};

beforeEach(() => vi.mocked(http).mockClear());

describe("bytesToBase64", () => {
  it("codifica bytes, inclusive acima de 32 KB (blocos)", () => {
    expect(bytesToBase64(new Uint8Array([72, 101, 108, 108, 111]))).toBe("SGVsbG8=");
    const big = new Uint8Array(70000).fill(65);
    expect(atob(bytesToBase64(big))).toBe("A".repeat(70000));
  });
});

describe("fileToBase64", () => {
  it("lê o arquivo inteiro sem o prefixo data:", async () => {
    const file = new File(["OFXHEADER:100"], "a.ofx", { type: "application/x-ofx" });
    expect(atob(await fileToBase64(file))).toBe("OFXHEADER:100");
  });
});

describe("balanceSummary", () => {
  it("sem saldos no arquivo", () => {
    expect(balanceSummary(null)).toEqual({ tone: "neutral", text: "O arquivo não traz saldos para conferir." });
  });

  it("saldos conferem", () => {
    expect(balanceSummary({ ok: true, checkedAt: "x", checkpoints: 14, mismatches: [] })).toEqual({
      tone: "ok", text: "Saldos conferem em 14 pontos.",
    });
    expect(balanceSummary({ ok: true, checkedAt: "x", checkpoints: 1, mismatches: [] }).text).toBe("Saldos conferem em 1 ponto.");
  });

  it("divergências, no singular e no plural", () => {
    const m = { dateISO: "2025-10-29", expectedCents: 1, computedCents: 2, diffCents: -1 };
    expect(balanceSummary({ ok: false, checkedAt: "x", checkpoints: 5, mismatches: [m] })).toEqual({
      tone: "warn", text: "1 divergência de saldo em 5 pontos conferidos.",
    });
    expect(balanceSummary({ ok: false, checkedAt: "x", checkpoints: 5, mismatches: [m, m] }).text).toBe(
      "2 divergências de saldo em 5 pontos conferidos.",
    );
  });
});

describe("chamadas à API", () => {
  it("detectFile envia nome e conteúdo em base64", async () => {
    await detectFile(new File(["abc"], "x.ofx"));
    expect(lastCall()).toEqual(["POST", "/import/detect", { fileName: "x.ofx", contentBase64: "YWJj" }]);
  });

  it("previewStatement, undoBatch e listBatches usam as rotas novas", async () => {
    await previewStatement({ accountId: "a1", text: "t", format: "ofx" });
    expect(lastCall()).toEqual(["POST", "/import/preview", { accountId: "a1", text: "t", format: "ofx" }]);
    await undoBatch("b1");
    expect(lastCall()).toEqual(["POST", "/import/b1/undo", {}]);
    await listBatches();
    expect(lastCall()[0]).toBe("GET");
    expect(lastCall()[1]).toBe("/import/batches");
  });
});
```

- [x] **Step 2: Rodar e confirmar a falha**

```bash
pnpm --filter @app/web test
```

Esperado: FAIL (módulo `../import-client` inexistente).

- [x] **Step 3: Criar `lib/import-client.ts`**

```ts
import { http } from "./http";
import type { Institution } from "./entity";

export type DetectedFormat = "ofx" | "pdf_statement" | "csv" | "pdf" | "unknown";

export interface DetectResponse {
  format: DetectedFormat;
  institution: Institution | null;
  kind: "statement" | "card_invoice" | null;
  accountRef: string | null;
  confidence: number;
  matchedAccountId: string | null;
  text: string | null;
}

export interface BalanceMismatch {
  dateISO: string;
  expectedCents: number;
  computedCents: number;
  diffCents: number;
}

export interface BalanceCheck {
  ok: boolean;
  checkedAt: string;
  checkpoints: number;
  mismatches: BalanceMismatch[];
}

export interface PreviewRow {
  type: "income" | "expense";
  amountCents: number;
  date: string;
  postedDate?: string | null;
  description: string | null;
  fingerprint: string;
  accountId?: string;
  dup: boolean;
}

export interface StatementPreview {
  batchId: string;
  institution: Institution | null;
  accountRef: string | null;
  period: { from: string; to: string } | null;
  rows: PreviewRow[];
  rowCount: number;
  dupCount: number;
  balanceCheck: BalanceCheck | null;
}

export interface BatchSummary {
  id: string;
  format: string;
  institution: Institution | null;
  accountName: string | null;
  rowCount: number;
  dupCount: number;
  inserted: number;
  balanceOk: boolean | null;
  createdAt: string;
  undoneAt: string | null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("falha ao ler o arquivo"));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function balanceSummary(check: BalanceCheck | null): { tone: "neutral" | "ok" | "warn"; text: string } {
  if (!check) return { tone: "neutral", text: "O arquivo não traz saldos para conferir." };
  if (check.ok) {
    const n = check.checkpoints;
    return { tone: "ok", text: `Saldos conferem em ${n} ${n === 1 ? "ponto" : "pontos"}.` };
  }
  const m = check.mismatches.length;
  return {
    tone: "warn",
    text: `${m} ${m === 1 ? "divergência" : "divergências"} de saldo em ${check.checkpoints} pontos conferidos.`,
  };
}

export async function detectFile(file: File): Promise<DetectResponse> {
  return http<DetectResponse>("POST", "/import/detect", {
    fileName: file.name,
    contentBase64: await fileToBase64(file),
  });
}

export function previewStatement(body: { accountId: string; text: string; format: "ofx" | "pdf_statement" }) {
  return http<StatementPreview>("POST", "/import/preview", body);
}

export function undoBatch(batchId: string) {
  return http<{ removed: number }>("POST", `/import/${batchId}/undo`, {});
}

export function listBatches() {
  return http<BatchSummary[]>("GET", "/import/batches");
}
```

- [x] **Step 4: Rodar os testes dos helpers**

```bash
pnpm --filter @app/web test
pnpm --filter @app/web typecheck
```

Esperado: testes passam (33 anteriores + 7 novos) e typecheck verde.

- [x] **Step 5: Reescrever `ImportView.vue`**

Substituir o conteúdo inteiro de `apps/web/src/views/ImportView.vue` por:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { http } from "../lib/http";
import { useFinanceStore } from "../stores/finance";
import { INSTITUTION_LABEL } from "../lib/entity";
import {
  balanceSummary, detectFile, previewStatement, undoBatch, listBatches,
  type BatchSummary, type DetectResponse, type PreviewRow, type StatementPreview,
} from "../lib/import-client";

const finance = useFinanceStore();

type Step = "upload" | "confirm" | "csv" | "ai" | "preview" | "done";
type SelectableRow = PreviewRow & { selected: boolean };

const step = ref<Step>("upload");
const file = ref<File | null>(null);
const detected = ref<DetectResponse | null>(null);
const selectedAccountId = ref("");
const rememberAccount = ref(true);
const erro = ref("");
const status = ref("");
const dragging = ref(false);

const preview = ref<StatementPreview | null>(null);
const previewRows = ref<SelectableRow[]>([]);
const batchId = ref("");
const batches = ref<BatchSummary[]>([]);

// CSV (mapeamento manual)
const csvText = ref("");
const csvHeaders = ref<string[]>([]);
const savedMappings = ref<Array<{ id: string; name: string; mapping: unknown }>>([]);
const selectedMappingId = ref("");
const mappingName = ref("");
const mapping = ref({
  dateColumn: "",
  amountColumn: "",
  descriptionColumn: "",
  dateFormat: "DD/MM/YYYY" as "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY",
  decimalSeparator: "," as "," | ".",
  expenseIsNegative: true,
});

onMounted(async () => {
  await finance.loadAccounts();
  await loadBatches();
});

const balance = computed(() => balanceSummary(preview.value?.balanceCheck ?? null));
const selectedCount = computed(() => previewRows.value.filter((r) => r.selected).length);
const selectedAccount = computed(() => finance.accounts.find((a) => a.id === selectedAccountId.value));
const canRemember = computed(
  () => !!detected.value?.accountRef && !!selectedAccount.value && !selectedAccount.value.externalId,
);
const kindLabel = computed(() => (detected.value?.kind === "card_invoice" ? "Fatura de cartão" : "Extrato de conta"));
const isStatement = computed(() => detected.value?.format === "ofx" || detected.value?.format === "pdf_statement");

async function loadBatches() {
  try {
    batches.value = await listBatches();
  } catch {
    /* histórico é secundário */
  }
}

function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void handleFile(f);
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) void handleFile(f);
}

async function handleFile(f: File) {
  erro.value = "";
  file.value = f;
  detected.value = null;
  status.value = "Lendo o arquivo...";
  try {
    const d = await detectFile(f);
    detected.value = d;
    status.value = "";
    if (d.format === "ofx" || d.format === "pdf_statement") {
      selectedAccountId.value = d.matchedAccountId ?? "";
      step.value = "confirm";
    } else if (d.format === "csv") {
      await prepareCsv(f);
      step.value = "csv";
    } else if (d.format === "pdf") {
      step.value = "ai";
    } else {
      erro.value = "Não reconheci este arquivo. Use um extrato OFX, PDF do C6 ou CSV.";
    }
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  }
}

async function prepareCsv(f: File) {
  csvText.value = await f.text();
  const firstLine = csvText.value.split("\n")[0] ?? "";
  csvHeaders.value = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const headers = csvHeaders.value;
  mapping.value.dateColumn = headers.find((h) => /data|date|dt/i.test(h)) ?? headers[0] ?? "";
  mapping.value.amountColumn = headers.find((h) => /valor|amount|value|credit|debit/i.test(h)) ?? headers[1] ?? "";
  mapping.value.descriptionColumn = headers.find((h) => /hist|desc|memo|lancamento|name/i.test(h)) ?? "";
  try {
    savedMappings.value = (await http<Array<{ id: string; name: string; format: string; mapping: unknown }>>("GET", "/import/mappings")).filter((m) => m.format === "csv");
  } catch {
    /* mapeamentos salvos são opcionais */
  }
}

function applyMapping(m: { id: string; name: string; mapping: unknown }) {
  selectedMappingId.value = m.id;
  Object.assign(mapping.value, m.mapping);
}

async function saveMapping() {
  if (!mappingName.value.trim()) return;
  try {
    await http("POST", "/import/mappings", { name: mappingName.value.trim(), format: "csv", mapping: mapping.value });
    mappingName.value = "";
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

function showPreview(data: { batchId: string; rows: PreviewRow[] }, p: StatementPreview | null) {
  preview.value = p;
  batchId.value = data.batchId;
  previewRows.value = data.rows.map((r) => ({ ...r, selected: !r.dup }));
  step.value = "preview";
}

async function runStatementPreview() {
  erro.value = "";
  if (!selectedAccountId.value || !detected.value?.text) return;
  status.value = "Analisando...";
  try {
    if (rememberAccount.value && canRemember.value) {
      await finance.updateAccount(selectedAccountId.value, { externalId: detected.value.accountRef });
    }
    const format = detected.value.format === "ofx" ? "ofx" : "pdf_statement";
    const p = await previewStatement({ accountId: selectedAccountId.value, text: detected.value.text, format });
    showPreview(p, p);
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    status.value = "";
  }
}

async function runCsvPreview() {
  erro.value = "";
  if (!selectedAccountId.value) { erro.value = "Selecione uma conta."; return; }
  status.value = "Analisando...";
  try {
    const data = await http<{ batchId: string; rows: PreviewRow[] }>("POST", "/import/csv/preview", {
      accountId: selectedAccountId.value,
      mapping: mapping.value,
      csv: csvText.value,
    });
    showPreview(data, null);
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    status.value = "";
  }
}

async function commit() {
  erro.value = "";
  status.value = "Importando...";
  try {
    const rows = previewRows.value.filter((r) => r.selected);
    const result = await http<{ inserted: number; skipped: number }>("POST", `/import/${batchId.value}/commit`, {
      rows: rows.map(({ type, amountCents, date, postedDate, fingerprint, description }) => ({
        type, amountCents, date, postedDate: postedDate ?? null, fingerprint, description, accountId: selectedAccountId.value,
      })),
    });
    status.value = `${result.inserted} transações importadas${result.skipped ? ` (${result.skipped} já existiam)` : ""}.`;
    step.value = "done";
    await loadBatches();
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  }
}

async function enqueuePdf() {
  if (!file.value) return;
  erro.value = "";
  status.value = "Enviando PDF...";
  try {
    const { url, storagePath } = await http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", {
      ext: "pdf",
      contentType: "application/pdf",
    });
    await fetch(url, { method: "PUT", body: file.value, headers: { "content-type": "application/pdf" } });
    const { jobId } = await http<{ jobId: string }>("POST", "/import/pdf", { storagePath });
    status.value = `PDF enviado para análise! Job: ${jobId}. Os lançamentos aparecerão em "Revisar".`;
    step.value = "done";
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  }
}

async function undo(b: BatchSummary) {
  if (!window.confirm(`Desfazer esta importação? ${b.inserted} lançamento(s) serão apagados.`)) return;
  erro.value = "";
  try {
    const { removed } = await undoBatch(b.id);
    status.value = `${removed} lançamento(s) removido(s).`;
    await loadBatches();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function reset() {
  step.value = "upload";
  file.value = null;
  detected.value = null;
  preview.value = null;
  previewRows.value = [];
  batchId.value = "";
  csvText.value = "";
  csvHeaders.value = [];
  selectedAccountId.value = "";
  erro.value = "";
  status.value = "";
}
</script>

<template>
  <section class="import">
    <h2>Importar extrato</h2>

    <p v-if="erro" role="alert" class="error">{{ erro }}</p>
    <p v-if="status" class="status">{{ status }}</p>

    <!-- 1: solte o arquivo -->
    <div v-if="step === 'upload'" class="card">
      <label
        class="dropzone"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <strong>Solte o arquivo aqui ou clique para escolher</strong>
        <span class="hint">OFX, PDF do extrato do C6 ou CSV. O banco e a conta são reconhecidos pelo próprio arquivo.</span>
        <input type="file" accept=".ofx,.qfx,.pdf,.csv,application/pdf,text/csv" @change="onPick" />
      </label>
    </div>

    <!-- 2: arquivo reconhecido -->
    <div v-if="step === 'confirm' && detected" class="card">
      <h3>Arquivo reconhecido</h3>
      <dl class="detected">
        <dt>Banco</dt>
        <dd>{{ detected.institution ? INSTITUTION_LABEL[detected.institution] : "—" }}</dd>
        <dt>Tipo</dt>
        <dd>{{ kindLabel }}</dd>
        <dt>Conta no arquivo</dt>
        <dd>{{ detected.accountRef ?? "—" }}</dd>
      </dl>

      <p v-if="detected.kind === 'card_invoice'" class="hint">
        Faturas de cartão em OFX são importadas como lançamentos da conta de cartão escolhida.
      </p>

      <label class="field-label" for="import-account">Conta de destino</label>
      <select id="import-account" v-model="selectedAccountId">
        <option value="">— Selecione uma conta —</option>
        <option v-for="a in finance.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <p v-if="detected.matchedAccountId" class="hint">Conta reconhecida pelo número do arquivo.</p>

      <label v-if="canRemember" class="remember">
        <input type="checkbox" v-model="rememberAccount" />
        Lembrar que o número {{ detected.accountRef }} é desta conta
      </label>

      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Trocar arquivo</button>
        <button :disabled="!selectedAccountId || !isStatement" @click="runStatementPreview">Ver preview</button>
      </div>
    </div>

    <!-- 2b: CSV com mapeamento manual -->
    <div v-if="step === 'csv'" class="card">
      <h3>CSV: mapeamento de colunas</h3>
      <label class="field-label" for="csv-account">Conta</label>
      <select id="csv-account" v-model="selectedAccountId">
        <option value="">— Selecione uma conta —</option>
        <option v-for="a in finance.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>

      <div v-if="savedMappings.length" class="mapping-saved">
        <span>Usar salvo:</span>
        <button
          v-for="m in savedMappings" :key="m.id"
          :class="['btn-small', { active: selectedMappingId === m.id }]"
          @click="applyMapping(m)"
        >{{ m.name }}</button>
      </div>

      <div class="mapping-grid">
        <label>Coluna data</label>
        <select v-model="mapping.dateColumn">
          <option v-for="h in csvHeaders" :key="h" :value="h">{{ h }}</option>
        </select>
        <label>Coluna valor</label>
        <select v-model="mapping.amountColumn">
          <option v-for="h in csvHeaders" :key="h" :value="h">{{ h }}</option>
        </select>
        <label>Coluna descrição</label>
        <select v-model="mapping.descriptionColumn">
          <option value="">— nenhuma —</option>
          <option v-for="h in csvHeaders" :key="h" :value="h">{{ h }}</option>
        </select>
        <label>Formato data</label>
        <select v-model="mapping.dateFormat">
          <option value="DD/MM/YYYY">DD/MM/AAAA</option>
          <option value="YYYY-MM-DD">AAAA-MM-DD</option>
          <option value="MM/DD/YYYY">MM/DD/AAAA</option>
        </select>
        <label>Separador decimal</label>
        <select v-model="mapping.decimalSeparator">
          <option value=",">, (vírgula)</option>
          <option value=".">. (ponto)</option>
        </select>
        <label>Despesas</label>
        <select v-model="mapping.expenseIsNegative">
          <option :value="true">Valores negativos</option>
          <option :value="false">Valores positivos</option>
        </select>
      </div>

      <div class="save-mapping">
        <input v-model="mappingName" placeholder="Nome do mapeamento (ex: Bradesco)" />
        <button class="btn-small" @click="saveMapping" :disabled="!mappingName.trim()">Salvar mapeamento</button>
      </div>

      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Trocar arquivo</button>
        <button :disabled="!selectedAccountId || !csvText" @click="runCsvPreview">Ver preview</button>
      </div>
    </div>

    <!-- 2c: PDF de banco desconhecido → IA -->
    <div v-if="step === 'ai'" class="card">
      <h3>Não reconheci o banco deste PDF</h3>
      <p class="hint">A IA pode extrair os lançamentos. Eles aparecerão em "Revisar" para confirmação.</p>
      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Trocar arquivo</button>
        <button @click="enqueuePdf">Interpretar com IA</button>
      </div>
    </div>

    <!-- 3: preview -->
    <div v-if="step === 'preview'" class="card">
      <h3>Preview ({{ selectedCount }} de {{ previewRows.length }} selecionados)</h3>

      <p :class="['balance', balance.tone]">{{ balance.text }}</p>
      <ul v-if="preview?.balanceCheck && !preview.balanceCheck.ok" class="mismatches">
        <li v-for="m in preview.balanceCheck.mismatches.slice(0, 3)" :key="m.dateISO">
          {{ formatDate(m.dateISO) }}: esperado {{ formatBRL(m.expectedCents) }}, calculado {{ formatBRL(m.computedCents) }}
        </li>
        <li v-if="preview.balanceCheck.mismatches.length > 3">
          e mais {{ preview.balanceCheck.mismatches.length - 3 }}…
        </li>
      </ul>
      <p v-if="preview?.balanceCheck && !preview.balanceCheck.ok" class="hint">
        A divergência não impede a importação, mas indica que o arquivo pode estar incompleto.
      </p>

      <p class="hint" v-if="previewRows.some(r => r.dup)">Linhas marcadas com ⚠ já existem e estão desmarcadas por padrão.</p>

      <div class="preview-controls">
        <button class="btn-small" @click="previewRows.forEach(r => !r.dup && (r.selected = true))">Selecionar novos</button>
        <button class="btn-small" @click="previewRows.forEach(r => r.selected = !r.dup)">Reset seleção</button>
      </div>

      <div class="preview-table">
        <div class="preview-row header">
          <span></span><span>Data</span><span>Tipo</span><span>Valor</span><span>Descrição</span>
        </div>
        <div
          v-for="(row, i) in previewRows" :key="i"
          :class="['preview-row', { dup: row.dup, selected: row.selected }]"
          @click="row.selected = !row.selected"
        >
          <input type="checkbox" v-model="row.selected" @click.stop />
          <span>{{ formatDate(row.date) }}</span>
          <span :class="row.type">{{ row.type === 'income' ? 'receita' : 'despesa' }}</span>
          <span>{{ formatBRL(row.amountCents) }}</span>
          <span class="desc">{{ row.description ?? '—' }} {{ row.dup ? '⚠' : '' }}</span>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Cancelar</button>
        <button @click="commit" :disabled="selectedCount === 0">
          Importar {{ selectedCount }} lançamento{{ selectedCount !== 1 ? 's' : '' }}
        </button>
      </div>
    </div>

    <!-- 4: concluído -->
    <div v-if="step === 'done'" class="card">
      <h3>Concluído</h3>
      <p>{{ status }}</p>
      <button @click="reset">Nova importação</button>
    </div>

    <!-- histórico -->
    <div class="card" v-if="batches.length">
      <h3>Importações anteriores</h3>
      <div class="history">
        <div v-for="b in batches" :key="b.id" :class="['history-row', { undone: b.undoneAt }]">
          <div class="history-info">
            <strong>{{ b.institution ? INSTITUTION_LABEL[b.institution] : b.format.toUpperCase() }}</strong>
            <span>{{ b.accountName ?? "—" }}</span>
            <span class="hint">{{ formatDate(b.createdAt) }} · {{ b.inserted }} de {{ b.rowCount }} lançamentos</span>
          </div>
          <span v-if="b.undoneAt" class="hint">desfeita</span>
          <span v-else-if="b.balanceOk === false" class="balance warn" title="Houve divergência de saldo no preview">⚠ saldo</span>
          <button v-if="!b.undoneAt" class="btn-small" @click="undo(b)">Desfazer</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.import { padding: calc(var(--space) * 3); max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
h2 { margin-bottom: 0; }
.card { background: var(--color-surface); padding: calc(var(--space) * 3); border-radius: var(--radius); display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
h3 { margin: 0; font-size: 1rem; }
.dropzone { display: flex; flex-direction: column; align-items: center; gap: var(--space); padding: calc(var(--space) * 6) calc(var(--space) * 3); border: 2px dashed #444; border-radius: var(--radius); cursor: pointer; text-align: center; }
.dropzone.dragging { border-color: var(--color-primary); background: rgba(79,124,255,.07); }
.dropzone input { display: none; }
.detected { display: grid; grid-template-columns: 1fr 2fr; gap: var(--space) calc(var(--space) * 2); margin: 0; font-size: 0.9rem; }
.detected dt { opacity: 0.6; }
.detected dd { margin: 0; font-weight: 600; }
.remember { display: flex; align-items: center; gap: var(--space); font-size: 0.85rem; cursor: pointer; }
.field-label { font-size: 0.85rem; opacity: 0.7; margin-bottom: -8px; }
select, input[type="text"], input:not([type]) {
  background: var(--color-bg); color: var(--color-text);
  border: 1px solid #333; border-radius: calc(var(--radius)/2);
  padding: calc(var(--space)*1.2); font-size: 0.9rem; width: 100%;
}
.mapping-saved { display: flex; align-items: center; gap: var(--space); flex-wrap: wrap; font-size: 0.85rem; opacity: 0.7; }
.mapping-grid { display: grid; grid-template-columns: 1fr 2fr; gap: calc(var(--space)) calc(var(--space)*2); align-items: center; font-size: 0.9rem; }
.save-mapping { display: flex; gap: var(--space); align-items: center; }
.save-mapping input { flex: 1; }
.hint { font-size: 0.85rem; opacity: 0.65; font-style: italic; }
.btn-row { display: flex; gap: var(--space); justify-content: flex-end; }
button { padding: calc(var(--space)*1.5) calc(var(--space)*2); border: none; border-radius: calc(var(--radius)/2); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 0.9rem; }
button:disabled { opacity: 0.4; cursor: default; }
.btn-secondary { background: #444; }
.btn-small { padding: calc(var(--space)) calc(var(--space)*1.5); font-size: 0.8rem; background: #333; }
.btn-small.active { background: var(--color-primary); }
.balance { font-size: 0.9rem; font-weight: 600; }
.balance.ok { color: #2ecc71; }
.balance.warn { color: #f39c12; }
.balance.neutral { opacity: 0.7; font-weight: 400; }
.mismatches { margin: 0; padding-left: calc(var(--space) * 3); font-size: 0.85rem; color: #f39c12; }
.preview-controls { display: flex; gap: var(--space); }
.preview-table { border: 1px solid #333; border-radius: calc(var(--radius)/2); overflow: hidden; }
.preview-row { display: grid; grid-template-columns: 28px 100px 80px 110px 1fr; gap: var(--space); padding: calc(var(--space)*1.2) calc(var(--space)*2); align-items: center; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid #222; }
.preview-row:last-child { border-bottom: none; }
.preview-row.header { font-weight: 600; opacity: 0.6; cursor: default; background: #1a1a1a; }
.preview-row:hover:not(.header) { background: rgba(79,124,255,.07); }
.preview-row.selected { background: rgba(79,124,255,.12); }
.preview-row.dup { opacity: 0.5; }
.income { color: #2ecc71; }
.expense { color: #e74c3c; }
.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history { display: flex; flex-direction: column; gap: var(--space); }
.history-row { display: flex; align-items: center; gap: calc(var(--space) * 2); padding: calc(var(--space) * 1.5) 0; border-bottom: 1px solid #222; }
.history-row:last-child { border-bottom: none; }
.history-row.undone { opacity: 0.5; }
.history-info { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 0.9rem; }
.error { color: #e74c3c; font-size: 0.9rem; }
.status { font-size: 0.9rem; opacity: 0.8; }
</style>
```

- [x] **Step 6: Typecheck e testes do web**

```bash
pnpm --filter @app/web typecheck
pnpm --filter @app/web test
```

Esperado: vue-tsc verde e todos os testes passando. (A verificação visual é a Task 8.)

- [x] **Step 7: Commit**

```bash
git add apps/web
git commit -m "$(cat <<'EOF'
feat(web): importação com detecção automática, conferência de saldo, histórico e desfazer

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Saneamento herdado das fases 9 e 10

**Files:**
- Create: `packages/shared/src/queue.ts`; Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/ingest/ingest.types.ts`, `apps/api/src/queue/queue.tokens.ts`
- Modify: `apps/worker/src/ai/ingest.processor.ts`, `apps/worker/src/queue.ts`, `apps/worker/package.json`
- Modify: `apps/worker/src/import/pdf.processor.ts`
- Create: `apps/worker/test/import-pdf-destroy.test.ts`, `apps/worker/test/reminders-processor.test.ts`
- Create: `apps/api/src/common/category-type-query.ts`; Modify: `apps/api/src/categories/categories.controller.ts`
- Create: `apps/api/src/find-root.ts`, `apps/worker/src/find-root.ts`; Modify: `apps/api/src/load-env.ts`, `apps/worker/src/load-env.ts`
- Create: `apps/api/test/unit/find-root.test.ts`, `apps/worker/test/find-root.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`

**Interfaces:**
- Produces: `@app/shared` exporta `AI_QUEUE_NAME`, `INGEST_JOB_NAME`, `INGEST_JOB_KINDS`, `IngestJobKind`, `IngestJobData`; `parseCategoryTypeQuery(value?: string): "income" | "expense" | undefined`; `findMonorepoRoot(startDir: string): string` (em cada app).

- [x] **Step 1: Tipos da fila em um lugar só**

Criar `packages/shared/src/queue.ts`:

```ts
export const AI_QUEUE_NAME = "ai";
export const INGEST_JOB_NAME = "ingest";

export const INGEST_JOB_KINDS = [
  "parse_text",
  "parse_image",
  "parse_audio",
  "parse_invoice",
  "categorize",
  "compute_insights",
] as const;
export type IngestJobKind = (typeof INGEST_JOB_KINDS)[number];

export interface IngestJobData {
  jobId: string;
  workspaceId: string;
  userId: string;
  kind: IngestJobKind;
  text?: string;
  storagePath?: string;
  /** Lote de importação cujo conjunto de transações deve ser categorizado (kind = categorize). */
  batchId?: string;
}
```

Em `packages/shared/src/index.ts`, acrescentar antes da linha `// Mesma instância de ZodError…`:

```ts
export * from "./queue";
```

Substituir `apps/api/src/ingest/ingest.types.ts` por:

```ts
export type { IngestJobData, IngestJobKind } from "@app/shared";
```

Em `apps/api/src/queue/queue.tokens.ts`, trocar a linha `export const AI_QUEUE_NAME = "ai";` por:

```ts
export { AI_QUEUE_NAME } from "@app/shared";
```

(mantendo as demais linhas do arquivo). Em `apps/worker/src/queue.ts`, substituir o conteúdo por:

```ts
export { AI_QUEUE_NAME as AI_QUEUE, INGEST_JOB_NAME as INGEST_JOB } from "@app/shared";
```

Em `apps/worker/src/ai/ingest.processor.ts`, remover a `export interface IngestJobData { … }` local e acrescentar, junto dos imports do topo:

```ts
import type { IngestJobData } from "@app/shared";
export type { IngestJobData };
```

Conferir os demais usos:

```bash
grep -rn "IngestJobData" apps --include='*.ts' | grep -v node_modules | grep -v generated
```

Esperado: nenhuma definição local restante (só imports). Ajustar qualquer import que aponte para a definição removida.

- [x] **Step 2: `tsx` declarado no worker, `destroy()` em `finally`**

```bash
pnpm --filter @app/worker add -D tsx@^4
```

Escrever o teste do `destroy` (deve falhar antes da correção). Criar `apps/worker/test/import-pdf-destroy.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

const pdf = vi.hoisted(() => ({ destroyCalls: 0 }));

vi.mock("pdf-parse", () => ({
  PDFParse: class {
    constructor(_opts: { data: Uint8Array }) {}
    async getText(): Promise<{ text: string }> {
      throw new Error("pdf corrompido");
    }
    async destroy() {
      pdf.destroyCalls++;
    }
  },
}));
vi.mock("../src/database", () => ({ prisma: {} }));
vi.mock("@aws-sdk/client-s3", () => ({ GetObjectCommand: vi.fn(), S3Client: vi.fn() }));

import { processPdfInvoice } from "../src/import/pdf.processor";

describe("processPdfInvoice", () => {
  it("libera o parser (destroy) mesmo quando a leitura do PDF falha", async () => {
    const s3 = { send: async () => ({ Body: (async function* () { yield new Uint8Array([1, 2, 3]); })() }) };
    await expect(
      processPdfInvoice(
        { jobId: "j1", workspaceId: "w1", userId: "u1", storagePath: "k.pdf" },
        { ai: {} as never, s3: s3 as never, s3Bucket: "b" },
      ),
    ).rejects.toThrow("pdf corrompido");
    expect(pdf.destroyCalls).toBe(1);
  });
});
```

```bash
pnpm --filter @app/worker exec vitest run test/import-pdf-destroy.test.ts
```

Esperado: FAIL (`destroyCalls` 0, pois o `destroy()` hoje vem depois do `getText()` sem `finally`).

Em `apps/worker/src/import/pdf.processor.ts`, substituir as quatro linhas da extração do texto:

```ts
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  const { text } = await parser.getText();
  await parser.destroy();
```

por:

```ts
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  let text: string;
  try {
    ({ text } = await parser.getText());
  } finally {
    await parser.destroy();
  }
```

```bash
pnpm --filter @app/worker test
```

Esperado: todos passam (17 anteriores + 1 novo).

- [x] **Step 3: Teste do upsert de lembretes (idempotência por chave)**

Criar `apps/worker/test/reminders-processor.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const captured = vi.hoisted(() => ({ processor: null as null | (() => Promise<void>) }));
vi.mock("bullmq", () => ({
  Worker: class {
    constructor(_queue: string, processor: () => Promise<void>) {
      captured.processor = processor;
    }
  },
  Queue: class {
    add = vi.fn();
  },
}));

const db = vi.hoisted(() => ({
  findBills: vi.fn(),
  upsert: vi.fn(),
  findSubs: vi.fn(),
}));
vi.mock("../src/database", () => ({
  prisma: {
    scheduledBill: { findMany: db.findBills },
    insight: { upsert: db.upsert },
    pushSubscription: { findMany: db.findSubs },
  },
}));

import { registerRemindersWorker } from "../src/reminders/reminders.processor";

describe("lembretes diários", () => {
  beforeEach(() => {
    db.findBills.mockReset();
    db.upsert.mockReset();
    db.findSubs.mockReset();
  });

  it("grava o insight por upsert com chave (workspace, tipo, dedupKey, período): rodar duas vezes não duplica", async () => {
    const today = new Date();
    db.findBills.mockResolvedValue([
      { id: "b1", name: "Luz", amountCents: 10000n, dueDate: today, workspaceId: "ws1" },
    ]);
    db.findSubs.mockResolvedValue([{ id: "s1", endpoint: "e", p256dh: "p", auth: "a" }]);
    const push = vi.fn().mockResolvedValue(undefined);

    registerRemindersWorker({} as never, push);
    await captured.processor!();
    await captured.processor!();

    const period = today.toISOString().slice(0, 10);
    expect(db.upsert).toHaveBeenCalledTimes(2);
    for (const [args] of db.upsert.mock.calls) {
      expect(args.where).toEqual({
        workspaceId_type_dedupKey_period: { workspaceId: "ws1", type: "budget_alert", dedupKey: "bill:b1", period },
      });
      expect(args.update).toEqual({});
    }
    expect(push).toHaveBeenCalledTimes(2); // uma notificação por execução e por inscrição
  });

  it("sem contas a vencer não grava nada", async () => {
    db.findBills.mockResolvedValue([]);
    registerRemindersWorker({} as never, vi.fn());
    await captured.processor!();
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
```

```bash
pnpm --filter @app/worker exec vitest run test/reminders-processor.test.ts
```

Esperado: 2 testes passam (o comportamento já existe; o teste o trava).

- [x] **Step 4: Raiz do monorepo a partir de `src/` ou `dist/`**

Criar `apps/api/src/find-root.ts` (e uma cópia idêntica em `apps/worker/src/find-root.ts`):

```ts
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Sobe a partir de `startDir` até achar `pnpm-workspace.yaml`; funciona tanto em `src/` quanto em `dist/`. */
export function findMonorepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`pnpm-workspace.yaml não encontrado acima de ${startDir}`);
    dir = parent;
  }
}
```

Em `apps/api/src/load-env.ts` e em `apps/worker/src/load-env.ts`, trocar a linha `const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");` por:

```ts
const monorepoRoot = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)));
```

e acrescentar `import { findMonorepoRoot } from "./find-root";` aos imports. Remover `resolve` do import de `node:path` só se ficar sem uso (o `resolve(monorepoRoot, file)` no laço continua usando).

Testes. Criar `apps/api/test/unit/find-root.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMonorepoRoot } from "../../src/find-root";

const base = realpathSync(mkdtempSync(join(tmpdir(), "find-root-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("findMonorepoRoot", () => {
  it("acha a raiz a partir de src/ e de dist/ (profundidades diferentes)", () => {
    const root = join(base, "repo");
    mkdirSync(join(root, "apps/api/src"), { recursive: true });
    mkdirSync(join(root, "apps/api/dist/nested"), { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    expect(findMonorepoRoot(join(root, "apps/api/src"))).toBe(root);
    expect(findMonorepoRoot(join(root, "apps/api/dist/nested"))).toBe(root);
  });

  it("lança erro quando não há pnpm-workspace.yaml acima", () => {
    const lonely = join(base, "sem-raiz/a/b");
    mkdirSync(lonely, { recursive: true });
    expect(() => findMonorepoRoot(lonely)).toThrow(/pnpm-workspace\.yaml/);
  });
});
```

Criar `apps/worker/test/find-root.test.ts` com o **mesmo conteúdo**, trocando só o import para `"../src/find-root"`.

```bash
pnpm --filter @app/api exec vitest run test/unit/find-root.test.ts
pnpm --filter @app/worker exec vitest run test/find-root.test.ts
```

Esperado: 2 testes passam em cada app. (Se o diretório temporário do sistema estiver dentro de uma árvore que contenha um `pnpm-workspace.yaml`, o segundo teste falharia: nesse caso ajustar o teste para criar o diretório sob `/`-nível próprio e reportar.)

- [x] **Step 5: Validação de `?type=` nas categorias, `main.ts` e testes da Fase 10**

Criar `apps/api/src/common/category-type-query.ts`:

```ts
import { BadRequestException } from "@nestjs/common";
import { CATEGORY_TYPES, type CategoryType } from "@app/shared";

/** Converte `?type=` (ausente, vazio, income ou expense) em `CategoryType | undefined`. */
export function parseCategoryTypeQuery(value?: string): CategoryType | undefined {
  if (value === undefined || value === "") return undefined;
  if ((CATEGORY_TYPES as readonly string[]).includes(value)) return value as CategoryType;
  throw new BadRequestException("type deve ser income ou expense");
}
```

Em `apps/api/src/categories/categories.controller.ts`, acrescentar `import { parseCategoryTypeQuery } from "../common/category-type-query";` e trocar, no método `list`, `this.service.list(user.workspaceId, type, parseEntityQuery(entity))` por:

```ts
    return this.service.list(user.workspaceId, parseCategoryTypeQuery(type), parseEntityQuery(entity));
```

Em `apps/api/src/categories/categories.service.ts`, tipar o parâmetro: trocar `async list(workspaceId: string, type?: string, entity?: AccountEntity)` por `async list(workspaceId: string, type?: "income" | "expense", entity?: AccountEntity)` e, no `where`, trocar `...(type ? { type: type as "income" | "expense" } : {})` por `...(type ? { type } : {})`.

Em `apps/api/src/main.ts`, acrescentar os ganchos de encerramento e o tratamento de falha do bootstrap. Substituir o bloco da função `bootstrap` e a chamada final por:

```ts
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 20 * 1024 * 1024 }),
  );
  app.enableShutdownHooks();
  registerAuthHandler(app.getHttpAdapter().getInstance());
  const port = Number(process.env["PORT"] ?? 3100);
  await app.listen(port, "0.0.0.0");
  console.log(`API ouvindo em http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error("Falha ao iniciar a API", err);
  process.exit(1);
});
```

Nos testes da Fase 10, em `apps/api/test/e2e/modelo-pf-pj.e2e.test.ts`: (a) no helper `seedPfPj`, trocar as duas funções locais `mk` e `tx` por versões que conferem o status:

```ts
    const mk = async (name: string, entity: "pf" | "pj") => {
      const res = await app.inject({ method: "POST", url: "/accounts", headers: u.h, payload: { type: "checking", name, entity } });
      expect(res.statusCode).toBe(201);
      return res.json().id as string;
    };
    const tx = async (payload: Record<string, unknown>) => {
      const res = await app.inject({ method: "POST", url: "/transactions", headers: u.h, payload: { date: "2026-06-10", amountCents: 1000, ...payload } });
      expect(res.statusCode).toBe(201);
      return res;
    };
```

(b) substituir o teste `"entity combina com busca textual"` por:

```ts
  it("entity combina com busca textual", async () => {
    const { u } = await seedPfPj("tx3");
    const pf = await app.inject({ method: "GET", url: "/transactions?entity=pf&q=mercado", headers: u.h });
    expect(descs(pf)).toEqual(["mercado"]);
    const pj = await app.inject({ method: "GET", url: "/transactions?entity=pj&q=mercado", headers: u.h });
    expect(descs(pj)).toEqual([]);
  });
```

(c) acrescentar ao final do arquivo:

```ts
describe("Fase 11 — validação de ?type= nas categorias", () => {
  it("?type= inválido retorna 400; income e expense continuam funcionando", async () => {
    const u = await newUser("ctype1");
    expect((await app.inject({ method: "GET", url: "/categories?type=foo", headers: u.h })).statusCode).toBe(400);
    const income = await app.inject({ method: "GET", url: "/categories?type=income", headers: u.h });
    expect(income.statusCode).toBe(200);
    expect((income.json() as Array<{ type: string }>).every((c) => c.type === "income")).toBe(true);
  });
});
```

```bash
pnpm --filter @app/api exec vitest run test/e2e/modelo-pf-pj.e2e.test.ts
```

Esperado: passam (o teste de `?type=foo` falhava antes da correção com 500; confirme rodando-o antes de editar o controller, se quiser o vermelho explícito).

- [x] **Step 6: Suítes completas e typecheck**

```bash
pnpm turbo typecheck --force
pnpm turbo test --force
```

Esperado: exit 0 em ambos.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: tipos da fila em @app/shared, destroy() em finally, tsx no worker, raiz do monorepo a partir de dist/, shutdown hooks e ?type= validado

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Verificação de ponta a ponta, documentação e integração

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-30-fase-11-importacao.md` (marcar os passos)

**Interfaces:** nenhuma nova.

- [x] **Step 1: Typecheck, testes e drift, sem cache**

```bash
docker compose up -d
pnpm exec prisma migrate deploy
pnpm turbo typecheck --force
pnpm turbo test --force
pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script | grep -c "empty migration"
```

Esperado: exit 0, nenhum teste falhando e a contagem final `1`. Anotar os totais por pacote (shared, api, worker, web) para o README e se o teste dos PDFs reais rodou ou foi ignorado.

- [x] **Step 2: Fluxo pela API com os extratos reais (nada é gravado)**

Sobe os apps e faz `detect` e `preview` com os PDFs reais de `~/Downloads`. Não há `commit`, então nenhum lançamento real entra no banco; o script não imprime descrições, só contagens.

```bash
pnpm dev > "$TMPDIR/dev.log" 2>&1 &
sleep 30
B=http://localhost:3100; TS=$(date +%s)
TOKEN=$(curl -s -X POST $B/api/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:5173' \
  -d "{\"email\":\"f11_$TS@test.com\",\"password\":\"F11-$TS-pw!\",\"name\":\"F11\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
H=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json')
for KIND in PF PJ; do
  FILE=~/Downloads/"Extrato C6 Bank $KIND.pdf"
  [ -f "$FILE" ] || { echo "$KIND: arquivo ausente, pulando"; continue; }
  python3 - "$FILE" > "$TMPDIR/detect-$KIND.json" <<'E'
import sys,json,base64
print(json.dumps({"fileName":"extrato.pdf","contentBase64":base64.b64encode(open(sys.argv[1],"rb").read()).decode()}))
E
  DET=$(curl -s -X POST $B/import/detect "${H[@]}" --data @"$TMPDIR/detect-$KIND.json")
  echo "$KIND detect: $(echo "$DET" | python3 -c 'import sys,json;d=json.load(sys.stdin);print({k:d[k] for k in ("format","institution","kind","accountRef","confidence")})')"
  ACC=$(curl -s -X POST $B/accounts "${H[@]}" -d "{\"type\":\"checking\",\"name\":\"C6 $KIND\",\"entity\":\"$( [ $KIND = PF ] && echo pf || echo pj )\",\"institution\":\"c6\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
  echo "$DET" | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps({'accountId':'$ACC','text':d['text'],'format':d['format']}))" > "$TMPDIR/prev-$KIND.json"
  curl -s -X POST $B/import/preview "${H[@]}" --data @"$TMPDIR/prev-$KIND.json" | python3 -c 'import sys,json;d=json.load(sys.stdin);bc=d["balanceCheck"];print("  preview:",{"rows":d["rowCount"],"dup":d["dupCount"],"balance_ok":bc["ok"],"checkpoints":bc["checkpoints"],"mismatches":len(bc["mismatches"])})'
done
rm -f "$TMPDIR"/detect-*.json "$TMPDIR"/prev-*.json
```

Esperado (com os extratos fornecidos): para PF e PJ, `detect` com `format: pdf_statement`, `institution: c6`, `kind: statement`; `preview` com `balance_ok: True` e `mismatches: 0` (PF: 41 linhas e 14 pontos; PJ: 338 linhas e 92 pontos). Se os arquivos não existirem, o passo imprime "arquivo ausente" e segue.

- [x] **Step 3: Fluxo completo na interface com um OFX sintético**

Com `pnpm dev` ainda rodando, abrir `http://localhost:5173`, entrar com a conta `f11_<ts>@test.com` (senha no comando acima) e abrir **Importar**. Criar antes uma conta (aba Contas) `Inter PJ` com entidade PJ, instituição Inter e número `555-1`.

O navegador embutido não tem seletor de arquivo; injetar o arquivo pelo console do navegador (`javascript_tool`):

```js
const ofx = `OFXHEADER:100\nDATA:OFXSGML\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>\n<BANKACCTFROM><BANKID>077<ACCTID>555-1</BANKACCTFROM>\n<BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260605<TRNAMT>-35.00<FITID>F1<MEMO>Padaria</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260610<TRNAMT>100.00<FITID>F2<MEMO>Pix recebido</STMTTRN>\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const dt = new DataTransfer();
dt.items.add(new File([ofx], "teste.ofx"));
const input = document.querySelector('.dropzone input[type=file]');
input.files = dt.files;
input.dispatchEvent(new Event("change", { bubbles: true }));
```

Conferir, registrando o resultado de cada item:

1. Aparece **Arquivo reconhecido** com Banco `Inter`, Tipo `Extrato de conta`, Conta no arquivo `555-1`, e a conta `Inter PJ` já selecionada ("Conta reconhecida pelo número do arquivo").
2. **Ver preview** mostra 2 linhas (`despesa` R$ 35,00 e `receita` R$ 100,00) e o texto "O arquivo não traz saldos para conferir." (OFX sem dois pontos de saldo).
3. **Importar 2 lançamentos** conclui com "2 transações importadas."; em **Transações** os 2 lançamentos aparecem na conta `Inter PJ`.
4. Repetir o mesmo arquivo: o preview marca as 2 linhas com ⚠ (duplicatas) e desmarcadas; o botão fica desabilitado com 0 selecionadas.
5. Em **Importações anteriores** aparece a importação (`Inter`, `Inter PJ`, `2 de 2 lançamentos`); **Desfazer** (confirmar o diálogo) remove os 2 lançamentos e a linha passa a "desfeita"; **Transações** não os mostra mais.
6. Soltar um arquivo de texto qualquer (`new File(["oi"], "x.bin")`) mostra "Não reconheci este arquivo…".

Se algum item falhar, corrigir na task correspondente antes de seguir.

- [x] **Step 4: Encerrar os servidores**

```bash
pkill -f 'turbo run dev'; pkill -f 'pnpm dev'; pkill -f 'tsx watch'; pkill -f 'nest start'; pkill -f vite
sleep 2
lsof -nP -iTCP:3100 -iTCP:5173 -sTCP:LISTEN | head -3
```

Esperado: sem saída (portas livres). Os dados do usuário `f11_*` ficam no banco de desenvolvimento e são apagados pela próxima execução dos testes e2e.

- [x] **Step 5: README**

Em `README.md`:

1. Seção "Modelos Prisma": nenhum modelo novo (nada a mudar); na árvore de pastas, trocar `10 migrations` por `11 migrations`.
2. Seção "Testes": atualizar as contagens com os números anotados no Step 1.
3. Em "Funcionalidades principais", trocar a linha `- **Importação de extratos** — OFX (bancos brasileiros) e PDF` por:

```markdown
- **Importação de extratos** — o arquivo é reconhecido sozinho (banco, tipo e conta): OFX de qualquer banco e extrato em PDF do C6 Bank (PF e PJ), com preview, marcação de duplicatas, conferência dos saldos declarados no extrato, histórico de importações e desfazer. CSV por mapeamento manual; PDF de outros bancos via IA
```

- [x] **Step 6: Marcar o plano e commitar a documentação**

```bash
sed -i '' 's/^- \[ \] \*\*Step/- [x] **Step/' docs/superpowers/plans/2026-09-30-fase-11-importacao.md
grep -c '^- \[ \]' docs/superpowers/plans/2026-09-30-fase-11-importacao.md
git add -A
git commit -m "$(cat <<'EOF'
docs: fecha a Fase 11 (plano marcado, README com importação por detecção e contagens)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
EOF
)"
git status --short
```

Esperado: o `grep -c` imprime `0` e o `git status --short` fica vazio.

- [x] **Step 7: Integrar em `main` (pedir autorização antes do push)**

Com autorização do usuário:

```bash
git checkout main
git merge --no-ff fase-11-importacao -m "Merge branch 'fase-11-importacao' into main"
git push origin main
```

Depois acompanhar o CI até concluir (`gh run list --limit 1`) e confirmar que todos os passos terminam em `success`.

---

## Self-Review

**Cobertura da spec (seções 3.4, 3.6 e 4) e dos pendentes:**
- 3.4 `ImportBatch` (`institution`, `detectedAccountRef`, `balanceCheck`, `undoneAt`) e `pdf_statement` → Task 1. Forma do `balanceCheck` estendida (decisão 3).
- 3.6 fingerprint com ordinal, sem colisão de Pix repetidos → Tasks 2 (`ordinalFingerprints`), 3 (parsers), 4 (CSV + compat. legada). OFX com FITID mantém `ofx:{conta}:{FITID}`.
- 4.1 fluxo detect → preview → commit → undo → Task 4 (detect, preview, commit) e Task 5 (undo). Passo 4.1.4 "pares de transferência" adiado para a fase 12 (decisão 7).
- 4.2 parsers: `c6-statement` e `ofx` (Latin-1 via decodificação por bytes, `BALAMT/DTASOF`, tolerância a `<STMTTRN>` sem fechamento que o parser já tinha) → Tasks 3 e 4. `c6-card-invoice`, presets CSV, `ai-pdf` unificado e Mercado Pago **não** entram (decisão 6, sem arquivo de exemplo).
- 4.3 verificação de saldo → Task 2 (`verifyBalances`), validada com os extratos reais (decisões 1 e 2) e exercitada em Task 5 (aceite real) e Task 8.
- 4.4 tela "Importar" (zona única, card detectado, preview com duplicatas e saldo, histórico com desfazer) → Task 6. O marcador de par de transferência da spec fica para a fase 12.
- Critérios de aceite da fase 3 da spec: "Extratos C6 PF e PJ importados com saldo batendo; reimport não duplica" → Task 4 (reimport = 0 inseridos), Task 5 (`import-real-statements.test.ts`) e Task 8 Step 2.
- Pendentes herdados: tipos da fila, `destroy()` em `finally`, `tsx`, shutdown hooks, `bootstrap().catch`, `load-env` a partir de `dist/`, teste do upsert de lembretes, `?type=` validado, hardening do teste `entity+q` → Task 7. A conferência de status dos POSTs do helper `seedPfPj` também entra na Task 7.

**Varredura de placeholders:** todo passo de código traz o código. Os únicos trechos descritivos são as edições de `import.module.ts` (o arquivo não foi lido por inteiro: a instrução é acrescentar o provider e o import) e a conferência de imports de `IngestJobData` (comando `grep` com saída esperada); ambos dizem exatamente o que procurar.

**Consistência de tipos e nomes:** `ParsedRow`/`BalancePoint`/`StatementParser`/`DetectResult` (Task 2) são os mesmos usados nos parsers (Task 3), no service (Task 4) e nos tipos do front (`PreviewRow`, `BalanceCheck` em `import-client.ts`, Task 6). `BalanceCheck.checkpoints` e `mismatches[].diffCents = esperado − calculado` aparecem iguais em `balance.ts`, nos testes e2e e em `balanceSummary`. `ordinalFingerprints` devolve `${key}|${n}`; o CSV usa `endsWith("|0")` para a compatibilidade legada e o teste da Task 4 cobre o caso. O formato do texto do `pdf-parse` (colunas por ` \t`) é o mesmo na fixture (`c6SampleText`), no `splitCells` e no extrator da API; o modo `layout` da fixture cobre `pdftotext -layout`. `postedDate` é `string | null` (ISO) no parser e na API e `Date` no banco, convertido em `commit`.

**Riscos conhecidos, registrados:** a detecção do C6 depende do layout (blocos mensais, colunas "Data lançamento/contábil", "Saldo do dia"), porque o texto do PDF não cita o banco de forma confiável; se outro banco usar o mesmo layout a detecção precisará ser refinada. O `bodyLimit` de 20 MB vale só em `main.ts` (os e2e usam o padrão e arquivos pequenos). O arquivo original do PDF não é guardado.
