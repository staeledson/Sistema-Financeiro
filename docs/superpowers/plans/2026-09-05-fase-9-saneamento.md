# Fase 9 — Saneamento · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o monorepo rodando de ponta a ponta nesta máquina (portas próprias), com typecheck verde nos três apps, sem código de debug, com o front enviando o workspace ativo em toda requisição, a fila de categorização funcionando de fato e o dashboard atual exibindo dados.

**Architecture:** Nenhuma funcionalidade nova. Correções de infraestrutura local (docker-compose, `.env`, proxy do Vite, `PORT`), correções de tipo pontuais, um cliente HTTP único no front (`apps/web/src/lib/http.ts`) consumido por todas as views, um `QueueModule` no NestJS que expõe a fila `ai` para os serviços que enfileiram, e o job `categorize` passando a aceitar `batchId`.

**Tech Stack:** pnpm 11 + Turborepo, NestJS 11 + Fastify 5, Prisma 7 (client gerado em `apps/api/generated/prisma` e `apps/worker/generated/prisma`), BullMQ 5 + ioredis, Vue 3 + Vite + Pinia, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-contas-pf-pj-import-ia-dashboards-design.md`, seção 7 e fase 1 da seção 10.

## Global Constraints

- Portas locais: Postgres `5433`, Redis `6380`, MinIO `9010` (API) e `9011` (console), API `3100`, Web `5173`. Nunca usar 5432/6379/9000/3000 (ocupadas pela stack PluralMed nesta máquina).
- Não tocar em nada da stack PluralMed em execução no Docker.
- Não alterar `prisma/schema.prisma` nem criar migrations nesta fase.
- Commits pequenos, mensagens em português no padrão `tipo(escopo): descrição`, sempre com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Todos os comandos rodam a partir da raiz do repositório salvo indicação contrária.
- Branch de trabalho: `fase-9-saneamento` (já existe, contém a spec).
- O working tree tem alterações não commitadas herdadas (proxy Vite, `load-env.ts`, `auth-handler.ts`, scripts `dev`, `.swcrc`, guard, lockfile). Elas são desejadas e entram nos commits das Tasks 1 e 2, conforme indicado. **Não** fazer `git stash`, `git checkout -- .` nem `git reset`.

---

### Task 1: Portas próprias e ambiente local funcional

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `.env` (arquivo local, ignorado pelo git: só as três URLs de infraestrutura)
- Modify: `apps/api/.env.test`
- Modify: `apps/api/vitest.config.ts:24-29`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/auth/index.ts:7`
- Modify: `apps/web/vite.config.ts:6-18`
- Create: `apps/worker/src/load-env.ts`
- Modify: `apps/worker/src/main.ts:1`
- Modify: `apps/worker/src/database.ts:1`
- Modify: `README.md:93-101` e `README.md:150-175`

**Interfaces:**
- Produces: API escuta em `process.env.PORT ?? 3100`. Front usa proxy `/api` → `http://localhost:3100`. Worker e API leem `.env` da raiz do monorepo.

- [x] **Step 1: Atualizar o docker-compose.yml**

Substituir o conteúdo inteiro de `docker-compose.yml` por:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: financas-postgres
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: financas
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: financas-redis
    ports:
      - "6380:6379"

  minio:
    image: minio/minio:latest
    container_name: financas-minio
    ports:
      - "9010:9000"
      - "9011:9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio123
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  minio_data:
```

- [x] **Step 2: Atualizar `.env.example` e o `.env` local**

Em `.env.example`, trocar as linhas:

```dotenv
DATABASE_URL=postgresql://app:app@localhost:5433/financas
REDIS_URL=redis://localhost:6380
BETTER_AUTH_URL=http://localhost:3100
MINIO_ENDPOINT=http://localhost:9010
```

e adicionar, logo abaixo de `BETTER_AUTH_URL`:

```dotenv
# Porta da API (o proxy do Vite em apps/web/vite.config.ts aponta para ela)
PORT=3100
```

No `.env` local (não versionado), aplicar só as trocas de porta, sem tocar em chaves:

```bash
sed -i '' \
  -e 's#localhost:5432/financas#localhost:5433/financas#' \
  -e 's#redis://localhost:6379#redis://localhost:6380#' \
  -e 's#http://localhost:9000#http://localhost:9010#' \
  .env
grep -q '^PORT=' .env || printf '\nPORT=3100\nBETTER_AUTH_URL=http://localhost:3100\n' >> .env
grep -E '^(DATABASE_URL|REDIS_URL|MINIO_ENDPOINT|PORT|BETTER_AUTH_URL)=' .env
```

Esperado: as cinco linhas com 5433, 6380, 9010, 3100, 3100.

- [x] **Step 3: Atualizar `apps/api/.env.test` e `apps/api/vitest.config.ts`**

`apps/api/.env.test`:

```dotenv
DATABASE_URL=postgresql://app:app@localhost:5433/financas
REDIS_URL=redis://localhost:6380
```

Em `apps/api/vitest.config.ts`, substituir o bloco `env: { ... }` por:

```ts
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5433/financas",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6380",
      BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters",
      BETTER_AUTH_URL: "http://localhost:3100",
    },
```

(O CI define `DATABASE_URL`/`REDIS_URL` nas portas padrão dos service containers; o fallback vale só para a máquina local.)

- [x] **Step 4: API lê `PORT` e Better Auth aponta para 3100**

`apps/api/src/main.ts` inteiro:

```ts
import "./load-env";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { registerAuthHandler } from "./auth/auth-handler";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  registerAuthHandler(app.getHttpAdapter().getInstance());
  const port = Number(process.env["PORT"] ?? 3100);
  await app.listen(port, "0.0.0.0");
  console.log(`API ouvindo em http://localhost:${port}`);
}
bootstrap();
```

Em `apps/api/src/auth/index.ts`, linha 7:

```ts
const baseURL = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3100";
```

- [x] **Step 5: Proxy do Vite para 3100**

Em `apps/web/vite.config.ts`, substituir o bloco `server:` por:

```ts
  server: {
    proxy: {
      "/api/auth": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
```

- [x] **Step 6: Worker lê `.env` da raiz**

Criar `apps/worker/src/load-env.ts`:

```ts
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

for (const file of [".env", ".env.local"]) {
  const path = resolve(monorepoRoot, file);
  if (existsSync(path)) config({ path, override: false });
}
```

Em `apps/worker/src/main.ts` e `apps/worker/src/database.ts`, trocar a primeira linha `import "dotenv/config";` por `import "./load-env";`.

- [x] **Step 7: README**

Em `README.md`, na tabela "Portas disponíveis após o `pnpm dev`", trocar `http://localhost:3000` por `http://localhost:3100` e `http://localhost:9001` por `http://localhost:9011`. No bloco `dotenv` de variáveis de ambiente, trocar `5432` por `5433`, `6379` por `6380`, `localhost:9000` por `localhost:9010`, e adicionar as linhas `BETTER_AUTH_URL=http://localhost:3100` e `PORT=3100` logo após `BETTER_AUTH_SECRET`. Adicionar, antes da tabela de portas, o parágrafo:

> As portas foram escolhidas para não colidir com outras stacks locais (5432/6379/9000/3000 costumam estar ocupadas). Ajuste no `docker-compose.yml` e no `.env` se precisar.

- [x] **Step 8: Subir a infra e aplicar migrations**

```bash
docker compose up -d
sleep 5
docker compose ps
pnpm exec prisma migrate deploy
pnpm exec prisma generate
```

Esperado: três containers `financas-*` `Up`; `migrate deploy` termina com "All migrations have been successfully applied" (ou "No pending migrations"); `generate` gera dois clients.

- [x] **Step 9: Verificar que a API sobe na porta certa**

```bash
(cd apps/api && timeout 25 pnpm dev >/tmp/api-dev.log 2>&1 || true); grep -E "ouvindo|EADDRINUSE|Error" /tmp/api-dev.log | head -5
```

Se `timeout` não existir no macOS, usar `pnpm dev & sleep 15; kill %1`. Esperado: linha `API ouvindo em http://localhost:3100` e nenhum `EADDRINUSE`.

- [x] **Step 10: Commit (inclui as alterações herdadas de ambiente)**

```bash
git add docker-compose.yml .env.example apps/api/.env.test apps/api/vitest.config.ts apps/api/src/main.ts apps/api/src/auth/index.ts apps/api/src/auth/auth-handler.ts apps/api/src/auth/current-user.guard.ts apps/api/src/load-env.ts apps/api/src/database.ts apps/api/.swcrc apps/api/package.json apps/web/vite.config.ts apps/web/src/lib/auth-client.ts apps/worker/src/load-env.ts apps/worker/src/main.ts apps/worker/src/database.ts apps/worker/package.json package.json turbo.json pnpm-lock.yaml README.md
git commit -m "chore(infra): portas próprias (5433/6380/9010/3100), .env da raiz, proxy Vite e scripts dev

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Remover código de debug e ignorar artefatos locais

**Files:**
- Modify: `apps/api/src/accounts/accounts.controller.ts:15-17`
- Modify: `apps/web/src/lib/api.ts:1-33`
- Modify: `apps/web/src/views/ImportView.vue:8`, `apps/web/src/views/IngestView.vue:6`, `apps/web/src/views/ReviewView.vue:8`
- Delete: `.cursor/debug-ad1492.log`
- Modify: `.gitignore`

- [x] **Step 1: Remover o bloco de log em `accounts.controller.ts`**

Apagar as linhas entre `// #region agent log` e `// #endregion` (inclusive). O método fica:

```ts
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user.workspaceId, accountSchema.parse(body));
  }
```

- [x] **Step 2: Restaurar `req` limpo em `apps/web/src/lib/api.ts`**

Substituir tudo do início do arquivo até o fim da função `req` por:

```ts
import { useAuthStore } from "../stores/auth";

const BASE = import.meta.env.VITE_API_URL ?? "/api";

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const auth = useAuthStore();
  const headers: Record<string, string> = { authorization: `Bearer ${auth.token ?? ""}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}
```

(As três views mantêm `const BASE = import.meta.env.VITE_API_URL ?? "/api";` — a Task 7 remove isso ao migrar para o cliente único.)

- [x] **Step 3: Apagar o log e atualizar `.gitignore`**

```bash
rm -f .cursor/debug-ad1492.log
rmdir .cursor 2>/dev/null || true
```

Acrescentar ao final de `.gitignore`:

```
.cursor/
.vite/
.DS_Store
```

- [x] **Step 4: Verificar que não sobrou debug**

```bash
grep -rn "agent log\|127.0.0.1:7546\|debug-ad1492" apps packages --include=*.ts --include=*.vue
git status --short | grep -E "\.cursor|\.DS_Store|\.vite" || echo "ok: artefatos ignorados"
```

Esperado: o `grep` não retorna nada; a segunda linha imprime `ok: artefatos ignorados`.

- [x] **Step 5: Commit**

```bash
git add .gitignore apps/api/src/accounts/accounts.controller.ts apps/web/src/lib/api.ts apps/web/src/views/ImportView.vue apps/web/src/views/IngestView.vue apps/web/src/views/ReviewView.vue
git commit -m "chore: remove código de debug e ignora artefatos locais

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Typecheck verde na API

**Files:**
- Modify: `apps/api/package.json` (script `typecheck`, devDependency `@types/papaparse`)
- Modify: `apps/api/src/workspaces/workspaces.service.ts:2`
- Modify: `apps/api/src/auth/index.ts:25-62`
- Modify: `apps/api/src/chat/chat.service.ts:1-4,54`
- Modify: `apps/api/src/chat/tools.ts:1-2,200`
- Modify: `apps/api/src/export/export.service.ts:43`
- Modify: `apps/api/test/e2e/chat.e2e.test.ts` (8 ocorrências de `text: async () => ""`)

**Interfaces:**
- Produces: `pnpm --filter @app/api typecheck` disponível e verde.

- [x] **Step 1: Ver os erros atuais (baseline)**

```bash
cd apps/api && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -c "error TS"; cd ../..
```

Esperado: 18.

- [x] **Step 2: Tipos do papaparse e script `typecheck`**

```bash
pnpm --filter @app/api add -D @types/papaparse
```

Em `apps/api/package.json`, em `scripts`, adicionar `"typecheck": "tsc --noEmit"` após `"test"`.

- [x] **Step 3: Caminho dos enums gerados**

`apps/api/src/workspaces/workspaces.service.ts`, linha 2:

```ts
import type { MemberRole } from "../../generated/prisma/enums";
```

- [x] **Step 4: Hook do Better Auth sem retorno**

Em `apps/api/src/auth/index.ts`, dentro de `databaseHooks.user.create.after`, trocar `const ws = await prisma.workspace.create({` por `await prisma.workspace.create({` e apagar a linha `return ws;`.

- [x] **Step 5: `chartSpec` como JSON do Prisma**

Em `apps/api/src/chat/chat.service.ts`, adicionar após a linha 2:

```ts
import type { Prisma } from "../../generated/prisma/client";
```

e trocar a linha `chartSpec: chartSpec ?? undefined,` por:

```ts
        chartSpec: chartSpec ? (chartSpec as unknown as Prisma.InputJsonValue) : undefined,
```

- [x] **Step 6: `where` tipado em `tools.ts`**

Em `apps/api/src/chat/tools.ts`, adicionar após a linha 2:

```ts
import type { Prisma } from "../../generated/prisma/client";
```

e trocar `where: where as Parameters<typeof prisma.transaction.findMany>[0]["where"],` por:

```ts
        where: where as Prisma.TransactionWhereInput,
```

- [x] **Step 7: Buffer do ExcelJS**

Em `apps/api/src/export/export.service.ts`, trocar `return (await wb.xlsx.writeBuffer()) as Buffer;` por:

```ts
    return Buffer.from((await wb.xlsx.writeBuffer()) as unknown as ArrayBuffer);
```

- [x] **Step 8: Anotar o retorno dos mocks no teste de chat**

```bash
sed -i '' 's/text: async () => ""/text: async (): Promise<string> => ""/g' apps/api/test/e2e/chat.e2e.test.ts
grep -c 'Promise<string>' apps/api/test/e2e/chat.e2e.test.ts
```

Esperado: 8.

- [x] **Step 9: Typecheck e testes da API**

```bash
pnpm --filter @app/api typecheck
pnpm --filter @app/api test
```

Esperado: typecheck sem saída de erro (exit 0); todos os testes e2e passando (o teste de export continua gerando XLSX válido).

- [x] **Step 10: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/workspaces/workspaces.service.ts apps/api/src/auth/index.ts apps/api/src/chat/chat.service.ts apps/api/src/chat/tools.ts apps/api/src/export/export.service.ts apps/api/test/e2e/chat.e2e.test.ts
git commit -m "fix(api): typecheck verde — tipos papaparse, enums gerados, Prisma Json, Buffer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Typecheck verde no worker

**Files:**
- Modify: `package.json` (raiz — `pnpm.overrides`)
- Modify: `apps/worker/package.json` (`ioredis`)
- Modify: `apps/worker/src/ai/ingest.processor.ts:73`
- Modify: `apps/worker/src/import/pdf.processor.ts:22-25`
- Modify: `apps/worker/test/import-pdf.test.ts:3-6`
- Modify: `apps/worker/src/reminders/reminders.processor.ts:34-43`

**Interfaces:**
- Produces: `pnpm --filter @app/worker typecheck` verde; uma única versão de `ioredis` no lockfile.

- [x] **Step 1: Baseline**

```bash
cd apps/worker && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "^(src|test)/" | wc -l; cd ../..
```

Esperado: um número maior que zero (dez linhas de erro na análise inicial).

- [x] **Step 2: Uma versão só de ioredis**

Em `package.json` (raiz), adicionar no nível superior:

```json
  "pnpm": {
    "overrides": {
      "ioredis": "^5.11.1"
    }
  },
```

Em `apps/worker/package.json`, trocar `"ioredis": "^5.4.0"` por `"ioredis": "^5.11.1"`. Depois:

```bash
pnpm install
grep -E "^  ioredis@" pnpm-lock.yaml
```

Esperado: uma única linha `ioredis@5.11.x:`.

- [x] **Step 3: Blob a partir de Uint8Array**

Em `apps/worker/src/ai/ingest.processor.ts`, trocar a linha `const blob = new Blob([bytes], { type: "audio/webm" });` por:

```ts
          const blob = new Blob([Buffer.from(bytes)], { type: "audio/webm" });
```

- [x] **Step 4: pdf-parse v2 (classe `PDFParse`)**

Em `apps/worker/src/import/pdf.processor.ts`, substituir as linhas

```ts
  // Dynamic import because pdf-parse is CJS and may have issues with static ESM
  const pdfParse = await import("pdf-parse").then((m) => m.default ?? m);
  const pdfData = await pdfParse(Buffer.from(bytes));
  const text = pdfData.text;
```

por:

```ts
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  const { text } = await parser.getText();
  await parser.destroy();
```

Em `apps/worker/test/import-pdf.test.ts`, substituir o `vi.mock("pdf-parse", ...)` por:

```ts
vi.mock("pdf-parse", () => ({
  PDFParse: class {
    constructor(_opts: { data: Uint8Array }) {}
    async getText() {
      return { text: "Compra Netflix 15/06/2026 R$ 55,90\nCompra Uber 20/06/2026 R$ 12,40" };
    }
    async destroy() {}
  },
}));
```

- [x] **Step 5: Upsert de insight com a chave única correta**

O `@@unique` de `Insight` é `[workspaceId, type, dedupKey, period]`. Em `apps/worker/src/reminders/reminders.processor.ts`, substituir o bloco `await prisma.insight.upsert({ ... });` por:

```ts
          const period = today.toISOString().slice(0, 10);
          const dedupKey = `bill:${bill.id}`;
          await prisma.insight.upsert({
            where: { workspaceId_type_dedupKey_period: { workspaceId, type: "budget_alert", dedupKey, period } },
            update: {},
            create: {
              workspaceId,
              type: "budget_alert",
              dedupKey,
              period,
              payload: { billId: bill.id, name: bill.name, amountCents: Number(bill.amountCents), dueDate: bill.dueDate.toISOString().slice(0, 10) },
            },
          });
```

- [x] **Step 6: Typecheck e testes do worker**

```bash
pnpm --filter @app/worker typecheck
pnpm --filter @app/worker test
```

Esperado: typecheck exit 0; testes verdes (o `health.test.ts` usa Redis em `REDIS_URL`, que agora vem do `.env` da raiz na porta 6380 — se falhar por conexão, conferir `docker compose ps`).

- [x] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml apps/worker/package.json apps/worker/src/ai/ingest.processor.ts apps/worker/src/import/pdf.processor.ts apps/worker/test/import-pdf.test.ts apps/worker/src/reminders/reminders.processor.ts
git commit -m "fix(worker): typecheck verde — ioredis único, pdf-parse v2, Blob e chave única de insight

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: CI executa typecheck

**Files:**
- Modify: `.github/workflows/ci.yml` (após o step "Run migrations")
- Modify: `apps/web/src/components/ChatChart.vue:24`
- Modify: `apps/web/src/offline/__tests__/offline.test.ts:1-9`

- [x] **Step 0: Corrigir os dois erros pré-existentes do `vue-tsc` no web**

Baseline: `pnpm --filter @app/web typecheck` falha com duas linhas:
`src/components/ChatChart.vue(24,48): error TS2724: '...echarts/core' has no exported member named 'EChartsOption'` e
`src/offline/__tests__/offline.test.ts(9,3): error TS2304: Cannot find name 'vi'`.

Em `apps/web/src/components/ChatChart.vue`, na linha 24, trocar o tipo importado de `echarts/core`: `EChartsOption` → `EChartsCoreOption` (e renomear os usos desse tipo no mesmo arquivo, se houver).

Em `apps/web/src/offline/__tests__/offline.test.ts`, garantir que a primeira linha importe `vi` junto com o que já é importado de `vitest`, por exemplo `import { describe, it, expect, beforeEach, vi } from "vitest";` (manter os nomes já importados; só acrescentar `vi`).

Rodar `pnpm --filter @app/web typecheck` e `pnpm --filter @app/web test`. Esperado: exit 0 em ambos.

- [x] **Step 1: Adicionar o step**

Inserir entre `- name: Run migrations` e `- name: Test api`:

```yaml
      - name: Typecheck
        run: pnpm turbo typecheck
```

- [x] **Step 2: Rodar localmente o mesmo comando**

```bash
pnpm turbo typecheck
```

Esperado: `@app/shared`, `@app/api`, `@app/worker` e `@app/web` todos com sucesso (o `web` roda `vue-tsc --noEmit`).

- [x] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml apps/web/src/components/ChatChart.vue apps/web/src/offline/__tests__/offline.test.ts
git commit -m "ci: roda typecheck antes dos testes; corrige dois erros de tipo no web

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Cliente HTTP único no front com `x-workspace-id`

**Files:**
- Create: `apps/web/src/lib/http.ts`
- Test: `apps/web/src/lib/__tests__/http.test.ts`

**Interfaces:**
- Consumes: `useAuthStore().token`, `useWorkspaceStore().activeId`.
- Produces:
  ```ts
  export const API_BASE: string;                       // "/api" ou VITE_API_URL
  export class HttpError extends Error { status: number; body: string }
  export function http<T = unknown>(method: "GET"|"POST"|"PATCH"|"PUT"|"DELETE", path: string, body?: unknown): Promise<T>;
  export function authHeaders(): Record<string, string>; // authorization + x-workspace-id (sem content-type), para uploads/fetch manual
  ```
  `http` sempre envia `authorization: Bearer <token>`; envia `x-workspace-id` quando há workspace ativo; envia `content-type: application/json` quando há body; lança `HttpError` com a mensagem do corpo (campo `message` se o corpo for JSON, senão o texto) quando `!res.ok`; retorna `undefined as T` em respostas `204` ou corpo vazio.

- [x] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/lib/__tests__/http.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuthStore } from "../../stores/auth";
import { useWorkspaceStore } from "../../stores/workspace";
import { http, HttpError, authHeaders } from "../http";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

beforeEach(() => {
  setActivePinia(createPinia());
  fetchMock.mockReset();
  useAuthStore().token = "tok123";
  useWorkspaceStore().activeId = "ws_abc";
});

describe("http", () => {
  it("envia authorization e x-workspace-id em GET, sem content-type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: 1 }]));
    const data = await http<Array<{ id: number }>>("GET", "/accounts");
    expect(data).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/accounts");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ authorization: "Bearer tok123", "x-workspace-id": "ws_abc" });
    expect(init.body).toBeUndefined();
  });

  it("serializa body e envia content-type em POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: "x" }));
    await http("POST", "/accounts", { name: "Nubank" });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "Nubank" }));
  });

  it("omite x-workspace-id quando não há workspace ativo", async () => {
    useWorkspaceStore().activeId = null;
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await http("GET", "/workspaces");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["x-workspace-id"]).toBeUndefined();
  });

  it("lança HttpError com a mensagem do corpo JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { message: "conta inexistente", statusCode: 400 }));
    await expect(http("GET", "/x")).rejects.toMatchObject({ status: 400, message: "conta inexistente" });
    await expect(http("GET", "/x")).rejects.toBeInstanceOf(HttpError);
  });

  it("lança HttpError com o texto quando o corpo não é JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, "boom"));
    await expect(http("GET", "/x")).rejects.toMatchObject({ status: 500, message: "boom" });
  });

  it("retorna undefined em corpo vazio", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, text: async () => "", json: async () => { throw new Error("no body"); } });
    await expect(http("DELETE", "/x")).resolves.toBeUndefined();
  });

  it("authHeaders expõe só authorization e x-workspace-id", () => {
    expect(authHeaders()).toEqual({ authorization: "Bearer tok123", "x-workspace-id": "ws_abc" });
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @app/web test -- src/lib/__tests__/http.test.ts
```

Esperado: FAIL — `Cannot find module '../http'`.

- [x] **Step 3: Implementar `apps/web/src/lib/http.ts`**

```ts
import { useAuthStore } from "../stores/auth";
import { useWorkspaceStore } from "../stores/workspace";

export const API_BASE: string = import.meta.env.VITE_API_URL ?? "/api";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** Cabeçalhos de autenticação e workspace, para uploads e chamadas fora do `http`. */
export function authHeaders(): Record<string, string> {
  const auth = useAuthStore();
  const ws = useWorkspaceStore();
  const h: Record<string, string> = { authorization: `Bearer ${auth.token ?? ""}` };
  if (ws.activeId) h["x-workspace-id"] = ws.activeId;
  return h;
}

function messageFrom(text: string): string {
  if (!text) return "Erro na requisição";
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.join("; ");
  } catch {
    /* corpo não é JSON */
  }
  return text;
}

export async function http<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers = authHeaders();
  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, messageFrom(text), text);
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
```

Observação: `stores/workspace.ts` passará a importar `http` na Task 7. A importação circular é segura porque ambos só usam o outro dentro de funções.

- [x] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @app/web test -- src/lib/__tests__/http.test.ts
```

Esperado: 7 testes passando.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/http.ts apps/web/src/lib/__tests__/http.test.ts
git commit -m "feat(web): cliente HTTP único com authorization e x-workspace-id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Migrar `api.ts`, stores e views para o cliente único

**Files:**
- Modify: `apps/web/src/lib/api.ts:1-20`
- Modify: `apps/web/src/stores/workspace.ts`
- Modify: `apps/web/src/stores/auth.ts` (remover `headers`)
- Modify: `apps/web/src/views/ImportView.vue`, `ReviewView.vue`, `IngestView.vue`, `BudgetsView.vue`, `GoalsView.vue`, `InsightsView.vue`, `InviteAcceptView.vue`, `MembersView.vue`, `ChatView.vue`, `SharedEntryView.vue`

**Interfaces:**
- Consumes: `http`, `authHeaders`, `HttpError` de `apps/web/src/lib/http.ts` (Task 6).
- Produces: nenhuma view ou store chama `fetch` diretamente para `/api/*`. Uploads para URL pré-assinada (MinIO) continuam com `fetch` puro, sem cabeçalhos de auth.

- [x] **Step 1: `api.ts` delega para `http`**

Substituir o topo de `apps/web/src/lib/api.ts` (imports, `BASE` e a função `req`) por:

```ts
import { http } from "./http";

function req<T>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  return http<T>(method, path, body);
}
```

Manter todo o restante do arquivo (tipos e objeto `api`).

- [x] **Step 2: `stores/workspace.ts`**

Substituir o arquivo inteiro por:

```ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useAuthStore } from "./auth";
import { http, authHeaders } from "../lib/http";

export interface WorkspaceInfo {
  id: string;
  type: string;
  name: string;
  currency: string;
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const workspaces = ref<WorkspaceInfo[]>([]);
  const activeId = ref<string | null>(null);
  const active = computed(() => workspaces.value.find((w) => w.id === activeId.value) ?? workspaces.value[0] ?? null);

  /** @deprecated use `http`/`authHeaders` de `lib/http`. Mantido só para compatibilidade durante a migração. */
  function headers(extra?: Record<string, string>) {
    return { ...authHeaders(), "content-type": "application/json", ...extra };
  }

  async function load() {
    const auth = useAuthStore();
    if (!auth.token) return;
    workspaces.value = await http<WorkspaceInfo[]>("GET", "/workspaces");
    if (!activeId.value && workspaces.value.length) {
      activeId.value = workspaces.value[0].id;
    }
  }

  function setActive(id: string) {
    activeId.value = id;
  }

  async function createWorkspace(type: string, name: string) {
    const ws = await http<WorkspaceInfo>("POST", "/workspaces", { type, name });
    workspaces.value.push(ws);
    return ws;
  }

  return { workspaces, activeId, active, headers, load, setActive, createWorkspace };
});
```

- [x] **Step 3: `stores/auth.ts` sem `headers`**

Remover o `computed` `headers` e a sua exportação no `return` (fica `return { token, userId, isAuthenticated, signIn, signUp, signOut };`). Remover `computed` do import se não for mais usado (ainda é: `isAuthenticated`).

- [x] **Step 4: `ImportView.vue`**

Trocar o import de `useAuthStore` e a constante `BASE` e a função `apiReq` por:

```ts
import { http, authHeaders } from "../lib/http";
```

e apagar `const auth = useAuthStore();` e `const BASE = ...;`. Substituir cada `apiReq(` por `http(`, mantendo os argumentos (`apiReq("GET", "/import/mappings")` → `http("GET", "/import/mappings")`, etc.). Em `loadMappings`, `savedMappings.value = (await http<Array<{ id: string; name: string; format: string; mapping: unknown }>>("GET", "/import/mappings")).filter((m) => m.format === "csv");`. Em `preview`, tipar: `let data = await http<{ batchId: string; rows: typeof previewRows.value; rowCount: number; dupCount: number }>(...)` (dois ramos). Em `commit`: `const result = await http<{ inserted: number }>("POST", ...)`. Em `enqueuePdf`: `const { url, storagePath } = await http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", {...})` e `const { jobId } = await http<{ jobId: string }>("POST", "/import/pdf", { storagePath })`. O `fetch(url, { method: "PUT", ... })` do upload para o MinIO permanece como está (não usa `authHeaders`).

- [x] **Step 5: `ReviewView.vue`**

Mesmo padrão: importar `{ http }` de `../lib/http`, remover `useAuthStore`, `auth`, `BASE` e `apiReq`. `load`: `drafts.value = await http<Draft[]>("GET", "/drafts");`. `confirm`: `await http("POST", \`/drafts/${draft.id}/confirm\`, { accountId: ov.accountId || null, categoryId: ov.categoryId || null });`. `discard`: `await http("DELETE", \`/drafts/${id}\`);`. Manter `useFinanceStore`.

- [x] **Step 6: `IngestView.vue`**

Importar `{ http }` de `../lib/http`; remover `useAuthStore`, `auth`, `BASE` e `apiPost`. Cada `apiPost(path, body)` vira `http<{ jobId: string }>("POST", path, body)` para `/ingest/text`, `/ingest/image`, `/ingest/audio`, e `http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", {...})` para a URL de upload. Os `fetch(url, { method: "PUT", ... })` para o MinIO permanecem.

- [x] **Step 7: `BudgetsView.vue`, `GoalsView.vue`, `InsightsView.vue`**

Em cada um, trocar `import { useAuthStore } from "../stores/auth";` e `const auth = useAuthStore();` por `import { http } from "../lib/http";`. Substituições:

BudgetsView:
```ts
async function load() {
  loading.value = true;
  try {
    statuses.value = await http<any[]>("GET", "/budgets/status");
  } finally {
    loading.value = false;
  }
}
async function save() {
  await http("POST", "/budgets", {
    method: form.value.method,
    limitCents: form.value.method === "fixed" ? Math.round(form.value.limitCents * 100) : null,
  });
  showForm.value = false;
  load();
}
async function deleteBudget(id: string) {
  await http("DELETE", `/budgets/${id}`);
  load();
}
```

GoalsView:
```ts
async function load() {
  loading.value = true;
  try {
    goals.value = await http<any[]>("GET", "/goals");
  } finally {
    loading.value = false;
  }
}
async function createGoal() {
  await http("POST", "/goals", {
    name: form.value.name,
    targetCents: Math.round(form.value.targetCents * 100),
    deadline: form.value.deadline || null,
  });
  showForm.value = false;
  form.value = { name: "", targetCents: 0, deadline: "" };
  load();
}
async function deleteGoal(id: string) {
  await http("DELETE", `/goals/${id}`);
  load();
}
async function submitContribution() {
  if (!contributeGoal.value) return;
  await http("POST", `/goals/${contributeGoal.value.id}/contribute`, { amountCents: Math.round(contribAmount.value * 100) });
  contributeGoal.value = null;
  load();
}
```

InsightsView:
```ts
async function load() {
  loading.value = true;
  try {
    insights.value = await http<any[]>("GET", "/insights");
  } finally {
    loading.value = false;
  }
}
async function markRead(ins: any) {
  if (ins.read) return;
  await http("PATCH", `/insights/${ins.id}/read`);
  ins.read = true;
}
async function triggerCompute() {
  computing.value = true;
  try {
    await http("POST", "/insights/compute");
    setTimeout(load, 3000);
  } finally {
    computing.value = false;
  }
}
```

- [x] **Step 8: `InviteAcceptView.vue`**

Trocar import/`auth` por `import { http, HttpError } from "../lib/http";` e o `try` do `onMounted` por:

```ts
  try {
    await http("POST", "/invitations/accept", { token });
    status.value = "success";
  } catch (e) {
    errorMsg.value = e instanceof HttpError ? e.message : "Erro de conexão";
    status.value = "error";
  }
```

- [x] **Step 9: `MembersView.vue`**

Manter `useWorkspaceStore` (usa `activeId` e `active`). Adicionar `import { http, HttpError } from "../lib/http";` e substituir as funções:

```ts
async function loadAll() {
  if (!wsStore.activeId) return;
  loading.value = true;
  try {
    const [m, i] = await Promise.all([
      http<any[]>("GET", `/workspaces/${wsStore.activeId}/members`).catch(() => []),
      http<any[]>("GET", "/invitations").catch(() => []),
    ]);
    members.value = m;
    invitations.value = i;
  } finally {
    loading.value = false;
  }
}
async function changeRole(member: any, role: string) {
  try {
    await http("PATCH", `/workspaces/${wsStore.activeId}/members/${member.user.id}/role`, { role });
    member.role = role;
  } catch { /* mantém o papel anterior */ }
}
async function removeMember(member: any) {
  if (!confirm(`Remover ${member.user.name}?`)) return;
  try {
    await http("DELETE", `/workspaces/${wsStore.activeId}/members/${member.user.id}`);
    members.value = members.value.filter((m) => m.user.id !== member.user.id);
  } catch (e) {
    alert(e instanceof HttpError ? e.message : "Erro ao remover membro");
  }
}
async function sendInvite() {
  sending.value = true;
  inviteMsg.value = "";
  inviteError.value = false;
  try {
    const data = await http<{ token: string }>("POST", "/invitations", { email: inviteEmail.value, role: inviteRole.value });
    inviteMsg.value = `Convite enviado! Token: ${data.token}`;
    inviteEmail.value = "";
    await loadAll();
  } catch (e) {
    inviteMsg.value = e instanceof HttpError ? e.message : "Erro ao convidar";
    inviteError.value = true;
  } finally {
    sending.value = false;
  }
}
async function revokeInvitation(inv: any) {
  try {
    await http("DELETE", `/invitations/${inv.id}`);
    invitations.value = invitations.value.filter((i) => i.id !== inv.id);
  } catch { /* mantém a lista */ }
}
```

- [x] **Step 10: `ChatView.vue`**

Remover `useWorkspaceStore`/`wsStore`; adicionar `import { http } from "../lib/http";`. Substituir:

```ts
async function loadList() {
  loadingList.value = true;
  try {
    conversations.value = await http<ConvSummary[]>("GET", "/chat");
  } catch { /* lista vazia */ } finally {
    loadingList.value = false;
  }
}
async function loadConversation(id: string) {
  activeId.value = id;
  messages.value = [];
  try {
    const { messages: msgs } = await http<{ messages: Message[] }>("GET", `/chat/${id}`);
    messages.value = msgs;
    scrollDown();
  } catch { /* mantém vazio */ }
}
```

e, dentro de `send`, o bloco `const res = await fetch("/api/chat", {...}); if (!res.ok) throw ...; const data = await res.json();` por:

```ts
    const data = await http<{ conversationId: string; answer: string; chart?: any }>("POST", "/chat", {
      message: text,
      conversationId: activeId.value ?? undefined,
    });
```

- [x] **Step 11: `SharedEntryView.vue`**

Remover `useWorkspaceStore`/`wsStore`; adicionar `import { http } from "../lib/http";`. Substituir as duas chamadas à API:

```ts
    const { url: uploadUrl, storagePath } = await http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", {
      ext: "jpg",
      contentType: "image/jpeg",
    });
```

(o endpoint espera `ext` e `contentType` e devolve `url`, conforme `apps/api/src/ingest/ingest.service.ts`; o código antigo mandava `filename` e lia `uploadUrl`, o que nunca funcionou) e

```ts
    await http("POST", "/ingest/image", { storagePath });
```

O `fetch(storedFile)` (data URL) e o `fetch(uploadUrl, { method: "PUT", ... })` permanecem.

- [x] **Step 12: Garantir que não sobrou `fetch("/api`**

```bash
grep -rn 'fetch("/api\|fetch(`/api\|fetch(`${BASE}' apps/web/src --include=*.vue --include=*.ts | grep -v __tests__
pnpm --filter @app/web typecheck
pnpm --filter @app/web test
```

Esperado: `grep` sem resultados; `vue-tsc` exit 0; todos os testes web passando.

- [x] **Step 13: Commit**

```bash
git add apps/web/src
git commit -m "refactor(web): todas as views e stores usam o cliente HTTP único (x-workspace-id em toda requisição)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `QueueModule` compartilhado e job `categorize` enfileirado de fato

**Files:**
- Create: `apps/api/src/queue/queue.module.ts`
- Create: `apps/api/src/queue/queue.tokens.ts`
- Modify: `apps/api/src/ingest/ingest.types.ts`
- Modify: `apps/api/src/ingest/ingest.service.ts`, `apps/api/src/ingest/ingest.module.ts`
- Modify: `apps/api/src/import/import.service.ts`, `apps/api/src/import/import.module.ts`
- Modify: `apps/api/src/insights/insights.service.ts`, `apps/api/src/insights/insights.module.ts`
- Modify: `apps/api/src/transactions/transactions.service.ts`, `apps/api/src/transactions/transactions.module.ts`
- Modify: `apps/worker/src/ai/ingest.processor.ts` (interface `IngestJobData` e chamada de `processCategorize`)
- Modify: `apps/worker/src/ai/categorize.processor.ts`
- Test: `apps/api/test/e2e/queue.e2e.test.ts`

**Interfaces:**
- Produces (API):
  ```ts
  // apps/api/src/queue/queue.tokens.ts
  export const AI_QUEUE_NAME = "ai";
  export const AI_QUEUE = Symbol("AI_QUEUE");   // token de injeção de Queue<IngestJobData>
  // apps/api/src/ingest/ingest.types.ts
  export interface IngestJobData { jobId: string; workspaceId: string; userId: string; kind: ...; text?: string; storagePath?: string; batchId?: string }
  ```
  `TransactionsService.enqueueCategorizationJob(workspaceId, userId, batchId?)` cria o `AiJob` **e** adiciona o job `ingest` com `kind: "categorize"` à fila. `ImportService.commit` chama-o ao final com o `batchId`.
- Produces (worker): `processCategorize({ jobId, workspaceId, batchId? })` filtra `importBatchId = batchId` quando informado.

- [x] **Step 1: Escrever o teste e2e que falha**

Criar `apps/api/test/e2e/queue.e2e.test.ts`:

```ts
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { Queue } from "bullmq";
import { AppModule } from "../../src/app.module";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";
import type { IngestJobData } from "../../src/ingest/ingest.types";

let app: NestFastifyApplication;
let queue: Queue<IngestJobData>;

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6380");

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  queue = new Queue<IngestJobData>("ai", { connection: { host: redisUrl.hostname, port: Number(redisUrl.port) || 6379 } });
  await queue.drain(true);
});

afterAll(async () => {
  await queue.drain(true);
  await queue.close();
  await cleanDb();
  await prisma.$disconnect();
  await app.close();
});

async function waitingJobs() {
  const jobs = await queue.getJobs(["waiting", "delayed", "prioritized"]);
  return jobs.map((j) => j.data);
}

describe("Fase 9 — fila de categorização", () => {
  it("POST /transactions/categorize cria AiJob e enfileira job kind=categorize", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `q1_${ts}@test.com`, password: "senha123!", name: "Q1" } });
    const h = { authorization: `Bearer ${u!.token}` };

    const res = await app.inject({ method: "POST", url: "/transactions/categorize", headers: h });
    expect(res.statusCode).toBe(201);
    const { id } = res.json() as { id: string };

    const aiJob = await prisma.aiJob.findUnique({ where: { id } });
    expect(aiJob?.kind).toBe("categorize");

    const jobs = await waitingJobs();
    const mine = jobs.find((j) => j.jobId === id);
    expect(mine).toBeDefined();
    expect(mine!.kind).toBe("categorize");
    expect(mine!.workspaceId).toBe(aiJob!.workspaceId);
    expect(mine!.batchId).toBeUndefined();
  });

  it("commit de importação enfileira categorize com o batchId", async () => {
    const ts = Date.now();
    const u = await auth.api.signUpEmail({ body: { email: `q2_${ts}@test.com`, password: "senha123!", name: "Q2" } });
    const h = { authorization: `Bearer ${u!.token}` };
    const jh = { ...h, "content-type": "application/json" };

    const acc = await app.inject({ method: "POST", url: "/accounts", headers: jh, payload: { type: "checking", name: "C6", openingBalanceCents: 0 } });
    const accountId = acc.json().id as string;

    const preview = await app.inject({
      method: "POST", url: "/import/csv/preview", headers: jh,
      payload: {
        accountId,
        mapping: { dateColumn: "Data", amountColumn: "Valor", descriptionColumn: "Desc", dateFormat: "DD/MM/YYYY", decimalSeparator: ".", expenseIsNegative: true },
        csv: "Data,Valor,Desc\n05/06/2026,-35.00,iFood\n",
      },
    });
    expect(preview.statusCode).toBe(200);
    const { batchId, rows } = preview.json() as { batchId: string; rows: unknown[] };

    const commit = await app.inject({ method: "POST", url: `/import/${batchId}/commit`, headers: jh, payload: { rows } });
    expect(commit.statusCode).toBe(200);
    expect(commit.json().inserted).toBe(1);

    const jobs = await waitingJobs();
    const mine = jobs.find((j) => j.kind === "categorize" && j.batchId === batchId);
    expect(mine).toBeDefined();
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @app/api test -- test/e2e/queue.e2e.test.ts
```

Esperado: FAIL — primeiro teste falha em `expect(mine).toBeDefined()` (job nunca enfileirado); segundo idem.

- [x] **Step 3: Tokens e módulo da fila**

`apps/api/src/queue/queue.tokens.ts`:

```ts
export const AI_QUEUE_NAME = "ai";
export const AI_QUEUE = Symbol("AI_QUEUE");
```

`apps/api/src/queue/queue.module.ts`:

```ts
import { Global, Module, type OnApplicationShutdown, Inject } from "@nestjs/common";
import { Queue } from "bullmq";
import type { IngestJobData } from "../ingest/ingest.types";
import { AI_QUEUE, AI_QUEUE_NAME } from "./queue.tokens";

function redisConnection() {
  const url = new URL(process.env["REDIS_URL"] ?? "redis://localhost:6380");
  return { host: url.hostname, port: Number(url.port) || 6379 };
}

@Global()
@Module({
  providers: [
    {
      provide: AI_QUEUE,
      useFactory: () => new Queue<IngestJobData>(AI_QUEUE_NAME, { connection: redisConnection() }),
    },
  ],
  exports: [AI_QUEUE],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>) {}
  async onApplicationShutdown() {
    await this.queue.close();
  }
}
```

Registrar em `apps/api/src/app.module.ts`: adicionar `import { QueueModule } from "./queue/queue.module";` e `QueueModule,` como primeiro item de `imports`.

- [x] **Step 4: `IngestJobData` ganha `batchId`**

`apps/api/src/ingest/ingest.types.ts`:

```ts
export type IngestJobKind = "parse_text" | "parse_image" | "parse_audio" | "parse_invoice" | "categorize" | "compute_insights";

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

- [x] **Step 5: Serviços passam a injetar a fila**

Em `apps/api/src/ingest/ingest.service.ts`, substituir o construtor e a constante:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { randomUUID } from "crypto";
import { prisma } from "../database";
import { StorageService } from "../storage/storage.service";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "./ingest.types";

@Injectable()
export class IngestService {
  constructor(
    private readonly storage: StorageService,
    @Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>,
  ) {}
```

(apagar `const AI_QUEUE = "ai";` e o bloco `this.queue = new Queue(...)`; o resto do arquivo permanece).

Em `apps/api/src/import/import.service.ts`, mesmo padrão:

```ts
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import Papa from "papaparse";
import { Queue } from "bullmq";
import { csvMappingSchema, csvRowToTransaction, parseOfx, importFingerprint } from "@app/shared";
import { prisma } from "../database";
import { StorageService } from "../storage/storage.service";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "../ingest/ingest.types";
import { TransactionsService } from "../transactions/transactions.service";

@Injectable()
export class ImportService {
  constructor(
    private readonly storage: StorageService,
    @Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>,
    private readonly transactions: TransactionsService,
  ) {}
```

e, em `commit`, antes do `return { inserted };`:

```ts
    if (inserted > 0) {
      await this.transactions.enqueueCategorizationJob(workspaceId, userId, batchId);
    }
```

Em `apps/api/src/import/import.module.ts`, adicionar `TransactionsModule` aos `imports`:

```ts
import { Module } from "@nestjs/common";
import { ImportController } from "./import.controller";
import { ImportService } from "./import.service";
import { StorageModule } from "../storage/storage.module";
import { TransactionsModule } from "../transactions/transactions.module";

@Module({
  imports: [StorageModule, TransactionsModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
```

Em `apps/api/src/insights/insights.service.ts`:

```ts
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue } from "bullmq";
import { prisma } from "../database";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "../ingest/ingest.types";

@Injectable()
export class InsightsService {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>) {}
```

(apagar a constante `AI_QUEUE = "ai"` local e o `new Queue`).

- [x] **Step 6: `TransactionsService.enqueueCategorizationJob` enfileira**

Em `apps/api/src/transactions/transactions.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Queue } from "bullmq";
import { transactionInputSchema, type TransactionInput } from "@app/shared";
import { prisma } from "../database";
import { CategoryRulesService } from "../category-rules/category-rules.service";
import { AI_QUEUE } from "../queue/queue.tokens";
import type { IngestJobData } from "../ingest/ingest.types";

@Injectable()
export class TransactionsService {
  constructor(
    @Inject(AI_QUEUE) private readonly queue: Queue<IngestJobData>,
    @Optional() private readonly rules?: CategoryRulesService,
  ) {}
```

e substituir o método:

```ts
  async enqueueCategorizationJob(workspaceId: string, userId: string, batchId?: string) {
    const job = await prisma.aiJob.create({
      data: { workspaceId, kind: "categorize", createdById: userId, inputRef: batchId ?? null },
      select: { id: true },
    });
    await this.queue.add("ingest", {
      jobId: job.id,
      workspaceId,
      userId,
      kind: "categorize",
      ...(batchId ? { batchId } : {}),
    });
    return job;
  }
```

Como `QueueModule` é `@Global()`, nenhum outro módulo precisa importá-lo.

- [x] **Step 7: Worker aceita `batchId`**

Em `apps/worker/src/ai/ingest.processor.ts`, na interface `IngestJobData`, adicionar `batchId?: string;` após `storagePath?: string;`. Na desestruturação do job, incluir `batchId`: `const { jobId, workspaceId, userId, kind, text, storagePath, batchId } = job.data;`. Na chamada: `await processCategorize({ jobId, workspaceId, batchId }, { ai: deps.ai });`.

Em `apps/worker/src/ai/categorize.processor.ts`:

```ts
export interface CategorizeJobData {
  jobId: string;
  workspaceId: string;
  /** Quando informado, categoriza só as transações desse lote de importação. */
  batchId?: string;
}
```

e, na consulta `uncategorized`, trocar `where: { workspaceId, categoryId: null },` por:

```ts
      where: { workspaceId, categoryId: null, ...(data.batchId ? { importBatchId: data.batchId } : {}) },
```

- [x] **Step 8: Rodar o teste novo e as suítes completas**

```bash
pnpm --filter @app/api test -- test/e2e/queue.e2e.test.ts
pnpm turbo typecheck
pnpm --filter @app/api test
pnpm --filter @app/worker test
```

Esperado: 2 testes novos passando; typecheck verde nos quatro pacotes; suítes da API e do worker verdes (os testes existentes de ingest/import continuam passando porque a `Queue` agora vem do módulo global).

- [x] **Step 9: Commit**

```bash
git add apps/api/src/queue apps/api/src/app.module.ts apps/api/src/ingest apps/api/src/import apps/api/src/insights apps/api/src/transactions apps/api/test/e2e/queue.e2e.test.ts apps/worker/src/ai/ingest.processor.ts apps/worker/src/ai/categorize.processor.ts
git commit -m "feat(api): QueueModule compartilhado; categorize enfileirado de fato e disparado após importação

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Dashboard atual volta a exibir a quebra por categoria

**Files:**
- Modify: `apps/web/src/lib/api.ts` (interface `Dashboard`)
- Modify: `apps/web/src/views/DashboardView.vue:22-31`
- Test: `apps/web/src/views/__tests__/dashboard-breakdown.test.ts`
- Create: `apps/web/src/lib/dashboard-format.ts`

**Interfaces:**
- Consumes: `GET /dashboard?month=YYYY-MM` devolve `{ cashflow: { incomeCents, expenseCents }, expenseBreakdown: Array<{ categoryId: string | null; name: string; totalCents: number }>, cashflowSeries: Array<{ month, incomeCents, expenseCents }> }` (ver `apps/api/src/dashboard/dashboard.service.ts`).
- Produces: `sortBreakdown(items): Array<{ name: string; amountCents: number; pct: number }>` em `apps/web/src/lib/dashboard-format.ts`.

- [x] **Step 1: Escrever o teste que falha**

Criar `apps/web/src/views/__tests__/dashboard-breakdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sortBreakdown } from "../../lib/dashboard-format";

describe("sortBreakdown", () => {
  it("ordena por valor desc e calcula percentual sobre o total", () => {
    const out = sortBreakdown([
      { categoryId: "a", name: "Mercado", totalCents: 3000 },
      { categoryId: "b", name: "Lazer", totalCents: 7000 },
    ]);
    expect(out.map((o) => o.name)).toEqual(["Lazer", "Mercado"]);
    expect(out[0]).toEqual({ name: "Lazer", amountCents: 7000, pct: 70 });
    expect(out[1].pct).toBe(30);
  });

  it("usa 'Sem categoria' quando o nome vier vazio e pct 0 quando total é zero", () => {
    expect(sortBreakdown([{ categoryId: null, name: "", totalCents: 0 }])).toEqual([
      { name: "Sem categoria", amountCents: 0, pct: 0 },
    ]);
  });
});
```

- [x] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @app/web test -- src/views/__tests__/dashboard-breakdown.test.ts
```

Esperado: FAIL — módulo `dashboard-format` não existe.

- [x] **Step 3: Implementar**

`apps/web/src/lib/dashboard-format.ts`:

```ts
export interface BreakdownItem {
  categoryId: string | null;
  name: string;
  totalCents: number;
}

export interface BreakdownRow {
  name: string;
  amountCents: number;
  pct: number;
}

export function sortBreakdown(items: BreakdownItem[]): BreakdownRow[] {
  const total = items.reduce((s, i) => s + i.totalCents, 0);
  return [...items]
    .sort((a, b) => b.totalCents - a.totalCents)
    .map((i) => ({
      name: i.name || "Sem categoria",
      amountCents: i.totalCents,
      pct: total > 0 ? Math.round((i.totalCents / total) * 100) : 0,
    }));
}
```

Em `apps/web/src/lib/api.ts`, substituir a interface `Dashboard` por:

```ts
export interface Dashboard {
  cashflow: { incomeCents: number; expenseCents: number };
  expenseBreakdown: { categoryId: string | null; name: string; totalCents: number }[];
  cashflowSeries: { month: string; incomeCents: number; expenseCents: number }[];
}
```

Em `apps/web/src/views/DashboardView.vue`, adicionar `import { sortBreakdown } from "../lib/dashboard-format";` e substituir os `computed` `breakdown` e `totalBreakdown` por:

```ts
const breakdown = computed(() => sortBreakdown(store.dashboard?.expenseBreakdown ?? []));
```

No template, trocar `:style="{ width: \`${(item.amountCents / totalBreakdown) * 100}%\` }"` por `:style="{ width: \`${item.pct}%\` }"`. A chamada `store.loadCategories()` no `onMounted` pode ficar (a view de categorias continua útil), mas o `breakdown` não depende mais dela.

- [x] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @app/web test
pnpm --filter @app/web typecheck
```

Esperado: todos os testes web verdes; `vue-tsc` exit 0.

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/dashboard-format.ts apps/web/src/views/DashboardView.vue apps/web/src/views/__tests__/dashboard-breakdown.test.ts
git commit -m "fix(web): dashboard lê totalCents/name do contrato real da API

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Verificação de ponta a ponta

**Files:** nenhum novo. Só execução.

- [x] **Step 1: Infra e migrations do zero**

```bash
docker compose down
docker compose up -d
sleep 5
pnpm exec prisma migrate deploy
```

Esperado: containers `financas-*` `Up`; migrations aplicadas.

- [x] **Step 2: Typecheck e testes de todo o monorepo**

```bash
pnpm turbo typecheck
pnpm turbo test
```

Esperado: exit 0 em ambos; nenhum teste ignorado ou falhando.

- [x] **Step 3: Subida manual dos três apps e chamada real**

```bash
pnpm dev > /tmp/dev.log 2>&1 &
sleep 25
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3100/workspaces
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/api/workspaces
grep -E "Worker started|ouvindo em" /tmp/dev.log
kill %1
```

Esperado: os dois `curl` retornam `401` (rota protegida, mas viva: a API está na 3100 e o proxy do Vite chega nela); o log mostra `API ouvindo em http://localhost:3100` e `Worker started`.

- [x] **Step 4: Working tree limpo**

```bash
git status --short
```

Esperado: vazio. Se sobrar algo, é um arquivo que uma task anterior esqueceu de adicionar: comitar na task correspondente (mensagem `chore: arquivos remanescentes da task N`).

---

## Self-Review

**Spec coverage (seção 7 da spec):**
- Portas próprias, `.env`, `PORT`, proxy Vite, README → Task 1.
- Typecheck: papaparse, enums, ChartSpec/Json, Buffer, ioredis, anotações no teste de chat → Tasks 3 e 4 (o worker tinha ainda pdf-parse v2, Blob e chave única do insight, cobertos na Task 4). Typecheck no CI → Task 5.
- Remover debug e ignorar artefatos → Task 2.
- Cliente HTTP único com `x-workspace-id` → Tasks 6 e 7 (todas as dez views e os dois stores, não só as quatro citadas na spec, porque `auth.headers` também não enviava o workspace).
- `enqueueCategorizationJob` enfileira de fato; `QueueModule`; commit de importação dispara com `batchId`; worker lê `batchId` → Task 8.
- Correção do dashboard atual (`totalCents`) → Task 9 (fase 1 da seção 10).
- Item 8 do diagnóstico (saldo em SQL) fica para a fase de dashboards, como a spec define na seção 6.2.

**Placeholder scan:** nenhum "TBD"/"similar à task N"; toda mudança de código tem o código.

**Type consistency:** `IngestJobData.batchId?: string` definido na Task 8 (API e worker) e usado no teste e2e e em `processCategorize`. `AI_QUEUE`/`AI_QUEUE_NAME` de `queue.tokens.ts` usados em todos os serviços. `http`/`authHeaders`/`HttpError` da Task 6 usados na Task 7 com as mesmas assinaturas. `sortBreakdown` da Task 9 recebe exatamente o shape de `Dashboard.expenseBreakdown`.
