# Fase 2 — Ingestão por IA · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps em checkbox.
>
> **Convenção:** scaffolding por comandos; código autoral por completo. Chamadas externas (OpenRouter, Groq) são **mockadas** nos testes — sem chaves vivas em CI. Reusa o harness da Fase 0 e os serviços da Fase 1. Repo: `docs/superpowers/plans/2026-06-25-fase-2-ingestao-ia.md`.

**Goal:** Lançar por **foto** (comprovante/Pix), **voz** e **texto livre**: a IA extrai uma transação estruturada que entra como **rascunho** para revisão; ao confirmar, vira transação real (validada pela Fase 1).

**Architecture:** Upload → API cria `ai_jobs` + enfileira BullMQ → worker chama OpenRouter (visão p/ imagem, texto p/ texto; voz = Groq Whisper → texto → parser) com **structured output (JSON)** → grava `transaction_drafts` (status `draft`). Tela de revisão confirma/descarta. Drafts **nunca** afetam saldo (tabela separada).

**Tech Stack:** OpenRouter (LLM gateway), Groq Whisper (STT), Supabase Storage (comprovantes), BullMQ/Redis, Zod, NestJS, Vue.

## Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Onde mora o rascunho | Tabela **`transaction_drafts`** própria (não `status` em `transactions`). Mantém ledger/saldo limpos; contorna o `CHECK` quando a conta é desconhecida. |
| 2 | Seleção de modelo | Via **env** (`OPENROUTER_VISION_MODEL`, `OPENROUTER_TEXT_MODEL`) — catálogo do OpenRouter muda; nunca hardcode no código. |
| 3 | Structured output | `response_format: json_schema` no OpenRouter + validação **Zod** no worker, com rotina de *repair* se vier malformado. |
| 4 | Voz | Áudio → **Groq Whisper** (`whisper-large-v3`) → texto → mesmo parser de texto. |
| 5 | Mapeamento de categoria | IA sugere categoria por **nome**; o worker casa por nome (case-insensitive) com as categorias do workspace; sem match → `category_id` null (usuário escolhe na revisão). |
| 6 | Conta | IA **não** adivinha a conta; o usuário escolhe no confirm. |

## Global Constraints

- Chamadas externas isoladas atrás de uma interface (`AiGateway`, `SttGateway`) → testáveis com mock.
- Drafts isolados por `workspace_id` (RLS). Confirmar reusa a validação da Fase 1 (`transactionInputSchema` + checagens de conta/categoria).
- Migrations continuam a numeração (próxima: `0011`).

---

## Task 1: `ai_jobs` — tabela e RLS

**Files:** Create `supabase/migrations/0011_ai_jobs.sql`. Test: `apps/api/test/database/ai_jobs.test.ts`.

**Interfaces:** Produces tabela `ai_jobs` (auditoria + status + custo). Consumida pelo worker (Tasks 5–6) e pelos endpoints de ingestão.

- [ ] **Step 1: Teste RLS (falha primeiro)** — usuário A insere um `ai_job` no próprio workspace e lê; B não vê (molde do `accounts.test`).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0011_ai_jobs.sql`:
```sql
create type ai_job_kind as enum ('parse_text','parse_image','parse_audio');
create type ai_job_status as enum ('queued','processing','done','failed');

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind ai_job_kind not null,
  status ai_job_status not null default 'queued',
  input_ref text,              -- caminho no storage (imagem/áudio) ou texto curto
  result jsonb,
  error text,
  cost_tokens int,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index ai_jobs_workspace_idx on ai_jobs(workspace_id);

alter table ai_jobs enable row level security;
create policy ai_jobs_select on ai_jobs for select using (is_member(workspace_id));
create policy ai_jobs_cud on ai_jobs for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: Aplicar e ver passar.**

- [ ] **Step 5: Commit** — `git commit -am "feat(ai): ai_jobs table with RLS"`

---

## Task 2: `transaction_drafts` — tabela e RLS

**Files:** Create `supabase/migrations/0012_transaction_drafts.sql`. Test: `apps/api/test/database/drafts.test.ts`.

**Interfaces:** Produces `transaction_drafts` (campos nuláveis — extração parcial é normal). Consumida por worker (grava) e API de revisão (Task 7).

- [ ] **Step 1: Teste (falha primeiro)** — inserir draft mínimo (só `workspace_id`+`kind`) funciona; isola por workspace.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0012_transaction_drafts.sql`:
```sql
create type draft_status as enum ('draft','discarded');

create table transaction_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  ai_job_id uuid references ai_jobs(id) on delete set null,
  kind ai_job_kind not null,
  status draft_status not null default 'draft',
  -- campos extraídos (todos nuláveis: extração pode ser parcial)
  type transaction_type,
  amount_cents bigint,
  date date,
  description text,
  counterparty text,
  suggested_category text,         -- nome cru sugerido pela IA
  category_id uuid references categories(id),
  account_id uuid references accounts(id),
  confidence numeric(3,2),         -- 0.00..1.00
  source_ref text,                 -- storage path / transcrição
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index drafts_workspace_status_idx on transaction_drafts(workspace_id, status);

alter table transaction_drafts enable row level security;
create policy drafts_select on transaction_drafts for select using (is_member(workspace_id));
create policy drafts_cud on transaction_drafts for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: Aplicar e ver passar.**

- [ ] **Step 5: Commit** — `git commit -am "feat(ai): transaction_drafts table with RLS"`

---

## Task 3: Storage de comprovantes (bucket + policies)

**Files:** Create `supabase/migrations/0013_receipts_bucket.sql`. Test: `apps/api/test/storage/receipts.test.ts`.

**Interfaces:** Produces bucket privado `receipts` com policies por workspace (path `{workspace_id}/...`). Web faz upload direto via supabase-js; worker lê via service role.

- [ ] **Step 1: Teste (falha primeiro)** — usuário A faz upload em `receipts/{wsA}/x.jpg` (sucesso) e falha ao subir em `receipts/{wsB}/x.jpg`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0013_receipts_bucket.sql`:
```sql
insert into storage.buckets (id, name, public)
values ('receipts','receipts', false)
on conflict (id) do nothing;

-- path convention: <workspace_id>/<uuid>.<ext> → 1ª pasta = workspace_id
create policy "receipts read"  on storage.objects for select
  using (bucket_id = 'receipts'
     and is_member( (storage.foldername(name))[1]::uuid ));
create policy "receipts write" on storage.objects for insert
  with check (bucket_id = 'receipts'
     and has_role( (storage.foldername(name))[1]::uuid,
                   array['owner','admin','member']::member_role[] ));
```

- [ ] **Step 4: Aplicar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- receipts` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(ai): private receipts bucket with per-workspace storage policies"`

---

## Task 4: Gateways de IA — OpenRouter + parser + mapeamento (lib do worker)

**Files:** Create em `apps/worker/src/ai/`: `openrouter.ts`, `stt-groq.ts`, `draft-schema.ts`, `parse.ts`, `category-map.ts`. Test: `apps/worker/test/parse.test.ts`.

**Interfaces:**
- Produces: `AiGateway.parseText(text)`, `AiGateway.parseImage(dataUrl)`, `SttGateway.transcribe(buffer)`, `mapCategory(name, categories)`. Consumido pelos processors (Tasks 5–6).

- [ ] **Step 1: Schema do rascunho extraído** — `apps/worker/src/ai/draft-schema.ts`:
```ts
import { z } from "zod";
export const extractedDraftSchema = z.object({
  type: z.enum(["income","expense","transfer"]),
  amountCents: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().nullish(),
  counterparty: z.string().nullish(),
  suggestedCategory: z.string().nullish(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedDraft = z.infer<typeof extractedDraftSchema>;

export const DRAFT_JSON_SCHEMA = {
  name: "transaction_draft",
  schema: {
    type: "object",
    properties: {
      type: { type: "string", enum: ["income","expense","transfer"] },
      amountCents: { type: "integer" },
      date: { type: "string" },
      description: { type: ["string","null"] },
      counterparty: { type: ["string","null"] },
      suggestedCategory: { type: ["string","null"] },
      confidence: { type: "number" },
    },
    required: ["type","amountCents","date","confidence"],
    additionalProperties: false,
  },
} as const;
```

- [ ] **Step 2: Teste do parser com OpenRouter mockado (falha primeiro)** — `apps/worker/test/parse.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { OpenRouterGateway } from "../src/ai/openrouter";
import { mapCategory } from "../src/ai/category-map";

beforeEach(() => fetchMock.mockReset());

describe("OpenRouterGateway.parseText", () => {
  it("extrai e valida o rascunho", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          type: "expense", amountCents: 3500, date: "2026-06-01",
          description: "Almoço iFood", counterparty: "iFood",
          suggestedCategory: "Restaurantes e delivery", confidence: 0.92,
        }) } }],
        usage: { total_tokens: 120 },
      }),
    });
    const gw = new OpenRouterGateway("key", "vision-x", "text-x");
    const r = await gw.parseText("almoço 35 no ifood ontem");
    expect(r.draft.amountCents).toBe(3500);
    expect(r.draft.type).toBe("expense");
    expect(r.costTokens).toBe(120);
  });
});

describe("mapCategory", () => {
  it("casa por nome case-insensitive; senão null", () => {
    const cats = [{ id: "c1", name: "Restaurantes e delivery", type: "expense" }];
    expect(mapCategory("restaurantes e delivery", "expense", cats)).toBe("c1");
    expect(mapCategory("Inexistente", "expense", cats)).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar.**

- [ ] **Step 4: Cliente OpenRouter** — `apps/worker/src/ai/openrouter.ts`:
```ts
import { extractedDraftSchema, ExtractedDraft, DRAFT_JSON_SCHEMA } from "./draft-schema";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const SYSTEM = "Você extrai UMA transação financeira do input do usuário em pt-BR. " +
  "amountCents é inteiro em centavos. date em YYYY-MM-DD (assuma o ano atual se ausente). " +
  "Responda SOMENTE com o JSON do schema.";

export class OpenRouterGateway {
  constructor(
    private apiKey: string,
    private visionModel: string,
    private textModel: string,
  ) {}

  private async call(model: string, content: unknown) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        response_format: { type: "json_schema", json_schema: DRAFT_JSON_SCHEMA },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = this.repairParse(raw);
    const draft: ExtractedDraft = extractedDraftSchema.parse(parsed);
    return { draft, costTokens: data.usage?.total_tokens ?? null };
  }

  private repairParse(raw: string): unknown {
    try { return JSON.parse(raw); }
    catch {
      const m = raw.match(/\{[\s\S]*\}/);     // tira cercas/preâmbulo
      if (!m) throw new Error("JSON irrecuperável do modelo");
      return JSON.parse(m[0]);
    }
  }

  parseText(text: string) {
    return this.call(this.textModel, text);
  }
  parseImage(dataUrl: string) {
    return this.call(this.visionModel, [
      { type: "text", text: "Extraia a transação deste comprovante." },
      { type: "image_url", image_url: { url: dataUrl } },
    ]);
  }
}
```

- [ ] **Step 5: Mapeamento de categoria** — `apps/worker/src/ai/category-map.ts`:
```ts
type Cat = { id: string; name: string; type: string };
export function mapCategory(name: string | null | undefined, type: string, cats: Cat[]): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const hit = cats.find(c => c.type === type && c.name.trim().toLowerCase() === n);
  return hit?.id ?? null;
}
```

- [ ] **Step 6: STT (Groq Whisper)** — `apps/worker/src/ai/stt-groq.ts`:
```ts
const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
export class GroqSttGateway {
  constructor(private apiKey: string, private model = "whisper-large-v3") {}
  async transcribe(file: Blob): Promise<string> {
    const form = new FormData();
    form.append("file", file, "audio.webm");
    form.append("model", this.model);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq ${res.status}`);
    const data = await res.json();
    return data.text as string;
  }
}
```

- [ ] **Step 7: Rodar e ver passar** — `pnpm --filter @app/worker test -- parse` → PASS.

- [ ] **Step 8: Commit** — `git commit -am "feat(ai): OpenRouter/Groq gateways, draft schema and category mapping"`

---

## Task 5: Pipeline de texto — job + endpoint + draft

**Files:** Create `apps/worker/src/ai/ingest.processor.ts`; `apps/api/src/ingest/*`. Test: `apps/worker/test/ingest-text.test.ts`.

**Interfaces:**
- Consumes: `OpenRouterGateway`, `ai_jobs`, `transaction_drafts`, `categories`.
- Produces: fila `ai` com job `ingest.parse_text`; `POST /ingest/text` (cria ai_job + enfileira). Resultado: 1 `transaction_draft`.

- [ ] **Step 1: Teste do processor mockado (falha primeiro)** — `ingest-text.test.ts`: injeta um `OpenRouterGateway` fake (retorna draft fixo) e um client supabase de teste; processa `{ jobId, workspaceId, kind:'parse_text', text }`; espera (a) `ai_jobs.status='done'`; (b) 1 linha em `transaction_drafts` com `amount_cents` e `category_id` mapeado.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Processor** — `apps/worker/src/ai/ingest.processor.ts`:
```ts
import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { createClient } from "@supabase/supabase-js";
import { OpenRouterGateway } from "./openrouter";
import { GroqSttGateway } from "./stt-groq";
import { mapCategory } from "./category-map";

export const AI_QUEUE = "ai";

export function registerIngestWorker(connection: Redis, deps: {
  ai: OpenRouterGateway; stt: GroqSttGateway;
  supabaseUrl: string; serviceKey: string;
}) {
  const sb = createClient(deps.supabaseUrl, deps.serviceKey,
    { auth: { persistSession: false } });

  return new Worker(AI_QUEUE, async (job) => {
    const { jobId, workspaceId, kind, text, storagePath } = job.data;
    await sb.from("ai_jobs").update({ status: "processing" }).eq("id", jobId);
    try {
      let result;
      if (kind === "parse_text") {
        result = await deps.ai.parseText(text);
      } else if (kind === "parse_image") {
        const { data } = await sb.storage.from("receipts").download(storagePath);
        const buf = Buffer.from(await data!.arrayBuffer());
        const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
        result = await deps.ai.parseImage(dataUrl);
      } else { // parse_audio
        const { data } = await sb.storage.from("receipts").download(storagePath);
        const transcript = await deps.stt.transcribe(data!);
        result = await deps.ai.parseText(transcript);
      }

      const { data: cats } = await sb.from("categories")
        .select("id,name,type").eq("workspace_id", workspaceId);
      const categoryId = mapCategory(result.draft.suggestedCategory, result.draft.type, cats ?? []);

      await sb.from("transaction_drafts").insert({
        workspace_id: workspaceId, ai_job_id: jobId, kind,
        type: result.draft.type, amount_cents: result.draft.amountCents,
        date: result.draft.date, description: result.draft.description ?? null,
        counterparty: result.draft.counterparty ?? null,
        suggested_category: result.draft.suggestedCategory ?? null,
        category_id: categoryId, confidence: result.draft.confidence,
        source_ref: storagePath ?? text ?? null,
        created_by: job.data.userId,
      });
      await sb.from("ai_jobs").update({
        status: "done", result: result.draft, cost_tokens: result.costTokens,
      }).eq("id", jobId);
      return { ok: true };
    } catch (e) {
      await sb.from("ai_jobs").update({ status: "failed", error: String(e) }).eq("id", jobId);
      throw e;
    }
  }, { connection });
}
```

- [ ] **Step 4: Endpoint de ingestão** — `apps/api/src/ingest/ingest.controller.ts` (texto):
```ts
import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { IngestService } from "./ingest.service";

@Controller("ingest")
export class IngestController {
  constructor(private readonly service: IngestService) {}
  @Post("text")
  text(@Headers("authorization") auth: string | undefined, @Body() body: { text: string }) {
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException();
    return this.service.enqueueText(token, body.text);
  }
}
```
`IngestService.enqueueText`: resolve `workspace_id` + `userId`, insere `ai_jobs` (kind `parse_text`), enfileira em `AI_QUEUE` `{ jobId, workspaceId, kind, text, userId }`, retorna `{ jobId }`. (Endpoints `image`/`audio` na Task 6.)

- [ ] **Step 5: Rodar e ver passar** — `pnpm --filter @app/worker test -- ingest-text` → PASS.

- [ ] **Step 6: Commit** — `git commit -am "feat(ai): text ingestion pipeline (ai_job → worker → draft)"`

---

## Task 6: Pipelines de imagem e voz

**Files:** Modify `apps/api/src/ingest/*` (rotas `image`/`audio`). Test: `apps/worker/test/ingest-image.test.ts`, `apps/worker/test/ingest-audio.test.ts`.

**Interfaces:** Produces `POST /ingest/image` e `POST /ingest/audio` (recebem o `storagePath` já enviado pela web ao bucket `receipts`); o worker já trata os três `kind` (Task 5).

- [ ] **Step 1: Testes mockados (falham primeiro)** — `ingest-image`: storage `download` mockado retorna um buffer; `parseImage` fake → draft; espera draft gravado. `ingest-audio`: `stt.transcribe` fake → texto; `parseText` fake → draft.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Rotas** — em `ingest.controller.ts` adicionar `@Post("image")` e `@Post("audio")` recebendo `{ storagePath }`; `IngestService` insere `ai_job` (`parse_image`/`parse_audio`) e enfileira `{ jobId, workspaceId, kind, storagePath, userId }`. (A lógica de processamento já existe na Task 5.)

- [ ] **Step 4: Rodar e ver passar.**

- [ ] **Step 5: Commit** — `git commit -am "feat(ai): image (vision) and audio (whisper) ingestion routes"`

---

## Task 7: Revisão — confirmar/descartar + tela

**Files:** Create `apps/api/src/drafts/*`; web `apps/web/src/views/ReviewView.vue`. Test: `apps/api/test/e2e/drafts.e2e.test.ts`.

**Interfaces:**
- Consumes: `transaction_drafts`; `TransactionsService.create` (Fase 1).
- Produces: `GET /drafts` (fila), `POST /drafts/:id/confirm` (body: `accountId` + overrides → cria transação real validada, marca draft `discarded`), `DELETE /drafts/:id`.

- [ ] **Step 1: e2e (falha primeiro)** — `drafts.e2e.test.ts`: semeia um draft (via service role) de despesa com `amount_cents` e `category_id`; `GET /drafts` retorna 1; `POST /drafts/:id/confirm { accountId }` → 201, cria 1 `transaction` confirmada (afeta o saldo), e o draft some da fila; `DELETE /drafts/:id` descarta.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Service de confirm** — `apps/api/src/drafts/drafts.service.ts` (núcleo):
```ts
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { clientFromToken } from "../supabase/supabase-request";
import { TransactionsService } from "../transactions/transactions.service";

@Injectable()
export class DraftsService {
  constructor(private readonly tx: TransactionsService) {}

  async list(token: string) {
    const sb = clientFromToken(token);
    const { data, error } = await sb.from("transaction_drafts")
      .select("*").eq("status", "draft").order("created_at", { ascending: false });
    if (error) throw error; return data ?? [];
  }

  async confirm(token: string, userId: string, id: string, overrides: Record<string, unknown>) {
    const sb = clientFromToken(token);
    const { data: d } = await sb.from("transaction_drafts").select("*").eq("id", id).single();
    if (!d) throw new NotFoundException();

    const input = {
      type: d.type, amountCents: Number(d.amount_cents), date: d.date,
      accountId: d.account_id, sourceAccountId: null, destAccountId: null,
      categoryId: d.category_id, description: d.description, counterparty: d.counterparty,
      ...overrides,                              // usuário escolhe conta / corrige campos
    };
    if (input.type !== "transfer" && !input.accountId)
      throw new BadRequestException("escolha uma conta para confirmar");

    const created = await this.tx.create(token, userId, input);   // reusa validação da Fase 1
    await sb.from("transaction_drafts").update({ status: "discarded" }).eq("id", id);
    return created;
  }

  async discard(token: string, id: string) {
    const sb = clientFromToken(token);
    const { data, error } = await sb.from("transaction_drafts")
      .update({ status: "discarded" }).eq("id", id).select();
    if (error) throw error;
    if (!data?.length) throw new NotFoundException();
    return { ok: true };
  }
}
```
Controller: `GET /drafts`, `POST /drafts/:id/confirm`, `DELETE /drafts/:id`; registrar módulo (provendo `TransactionsService`).

- [ ] **Step 4: Rodar e ver passar** — `pnpm supabase db reset && pnpm --filter @app/api test -- drafts.e2e` → PASS.

- [ ] **Step 5: Web (verificação manual)** — `ReviewView.vue`: lista os drafts (badge de `confidence`), permite escolher conta e ajustar categoria/valor/data, botões **Confirmar**/**Descartar**. Botões de ingestão na home: anexar foto (upload ao bucket `receipts/{workspaceId}/...` via supabase-js → `POST /ingest/image`), gravar áudio (`POST /ingest/audio`), caixa de texto (`POST /ingest/text`). Após o job, o draft aparece na revisão (polling simples ou Realtime do Supabase).

- [ ] **Step 6: Commit** — `git commit -am "feat(ai): draft review — confirm (creates real tx) and discard + web review screen"`

---

## Self-review (feito)

- **Cobertura:** foto (Task 6), voz (Tasks 4/6), texto (Task 5) → draft → revisão → transação real (Task 7). Saldos da Fase 1 intactos (drafts em tabela separada).
- **Externos testáveis:** OpenRouter/Groq atrás de gateways, mockados; sem chave viva em CI.
- **Segurança:** bucket privado com policy por workspace (Task 3); RLS em `ai_jobs`/`transaction_drafts`; worker usa service role só no backend.
- **Pontos de atenção:** (a) **modelos por env** — validar nomes atuais no catálogo do OpenRouter ao configurar; (b) o `repairParse` cobre JSON malformado, mas modelos sem suporte a `json_schema` exigem fallback de prompt — escolher modelos compatíveis; (c) `.env` do worker precisa de `OPENROUTER_API_KEY`, `OPENROUTER_VISION_MODEL`, `OPENROUTER_TEXT_MODEL`, `GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Execução

`subagent-driven` recomendado. Dependências: 1,2,3 (paralelas) → 4 → 5 → 6 → 7. A Task 4 (gateways) é o coração; as Tasks 5–6 só orquestram fila + storage em volta dela.

---

> **Próximas fases (sequência):** Fase 3 (Import CSV/OFX/fatura — reusa a fila e a revisão de drafts desta fase) · Fase 4 (Inteligência: categorização que aprende, anomalias, orçamentos, metas) · Fase 5 (Família/PJ + convite real) · Fase 6 (Chat com guardrails) · Fase 7 (Open Finance) · Fase 8 (PWA/push). As Fases 4, 6 e 7 têm decisões de design relevantes que eu travo com recomendação ao montar cada plano (como fiz aqui).
