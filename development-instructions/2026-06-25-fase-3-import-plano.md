# Fase 3 — Import (CSV/OFX/Fatura) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps em checkbox.
>
> **Convenção:** scaffolding por comandos; código autoral por completo. Reusa harness da Fase 0, serviços da Fase 1 e a fila/revisão da Fase 2. Repo: `docs/superpowers/plans/2026-06-25-fase-3-import.md`.

**Goal:** Trazer histórico e faturas: **CSV** (com mapeamento de colunas reutilizável) e **OFX** → transações confirmadas após preview; **fatura PDF** → extração por IA → rascunhos (revisão da Fase 2). Tudo **idempotente** (reimportar não duplica).

**Architecture:** Upload → preview (parse + dedup flags) → commit. CSV/OFX commitam direto via `ON CONFLICT DO NOTHING` por `import_fingerprint`. Fatura PDF vira job na fila `ai` (texto do PDF → OpenRouter → múltiplos drafts). `import_batches` registra cada importação.

**Tech Stack:** papaparse (CSV), parser OFX (FITID), pdf-parse + OpenRouter (fatura), Supabase, NestJS, BullMQ, Vue.

## Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Destino dos dados | CSV/OFX → transações **confirmadas** (preview antes). Fatura PDF → **rascunhos** (IA, reusa revisão da Fase 2). |
| 2 | Idempotência | Coluna `import_fingerprint` em `transactions` + índice único parcial por workspace. OFX usa **FITID**; CSV usa hash de `conta|data|valor|descrição`. |
| 3 | Mapeamento CSV | Salvo e reutilizável (`import_mappings`), com defaults BR (DD/MM/AAAA, decimal vírgula, despesa negativa). |
| 4 | Tipo na importação | Só `income`/`expense` (sinal do valor). Detecção de **transferência** entre contas fica adiada (reconciliação avançada). |
| 5 | Categoria na importação | `null` por padrão. Auto-categorização é da **Fase 4**. |
| 6 | Conta | Escolhida pelo usuário para o lote inteiro (CSV/OFX). |

## Global Constraints

- Reimportar o mesmo arquivo é **idempotente** (sem duplicatas).
- Migrations continuam a numeração (próxima: `0014`).
- Parsers puros e determinísticos → testáveis sem rede.

---

## Task 1: Migrations — `import_batches`, `import_mappings`, colunas de idempotência

**Files:** Create `supabase/migrations/0014_import.sql`. Test: `apps/api/test/database/import_schema.test.ts`.

**Interfaces:** Produces `import_batches`, `import_mappings`; colunas `import_fingerprint`/`import_batch_id` em `transactions` + índice único parcial. Consumido por todas as tasks seguintes.

- [ ] **Step 1: Teste (falha primeiro)** — `select` nas novas tabelas/colunas retorna sem erro; inserir duas transações com o mesmo `(workspace_id, import_fingerprint)` viola o índice único.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Migration** — `supabase/migrations/0014_import.sql`:
```sql
create type import_format as enum ('csv','ofx','pdf');
create type import_status as enum ('preview','committed','failed');

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  account_id uuid references accounts(id),
  format import_format not null,
  status import_status not null default 'preview',
  file_ref text,
  row_count int default 0,
  dup_count int default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index import_batches_workspace_idx on import_batches(workspace_id);

create table import_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  format import_format not null,
  mapping jsonb not null,
  unique (workspace_id, name)
);

alter table transactions
  add column import_fingerprint text,
  add column import_batch_id uuid references import_batches(id) on delete set null;

create unique index transactions_import_fp_uniq
  on transactions(workspace_id, import_fingerprint)
  where import_fingerprint is not null;

alter table import_batches enable row level security;
alter table import_mappings enable row level security;
create policy ib_select on import_batches for select using (is_member(workspace_id));
create policy ib_cud on import_batches for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
create policy im_select on import_mappings for select using (is_member(workspace_id));
create policy im_cud on import_mappings for all
  using (has_role(workspace_id, array['owner','admin','member']::member_role[]))
  with check (has_role(workspace_id, array['owner','admin','member']::member_role[]));
```

- [ ] **Step 4: Aplicar e ver passar.**

- [ ] **Step 5: Commit** — `git commit -am "feat(import): import_batches, import_mappings and idempotency columns"`

---

## Task 2: `@app/shared` — mapping schema + fingerprint + parsers puros

**Files:** Create `packages/shared/src/import.ts`; Modify `src/index.ts`. Test: `packages/shared/src/__tests__/import.test.ts`.

**Interfaces:** Produces `csvMappingSchema`, `importFingerprint()`, `parseBrDate()`, `parseAmountCents()`, `csvRowToTransaction()`. Determinístico, sem I/O. Consumido por api (Tasks 3–5).

- [ ] **Step 1: Teste (falha primeiro)** — `packages/shared/src/__tests__/import.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseBrDate, parseAmountCents, importFingerprint, csvRowToTransaction } from "../import";

describe("import helpers", () => {
  it("parseBrDate DD/MM/AAAA → ISO", () => {
    expect(parseBrDate("05/06/2026", "DD/MM/YYYY")).toBe("2026-06-05");
  });
  it("parseAmountCents com vírgula decimal", () => {
    expect(parseAmountCents("-1.234,56", ",")).toBe(-123456);
  });
  it("fingerprint é estável e normaliza descrição", () => {
    const a = importFingerprint("acc1", "2026-06-05", -3500, "  iFood   SP ");
    const b = importFingerprint("acc1", "2026-06-05", -3500, "ifood sp");
    expect(a).toBe(b);
  });
  it("csvRowToTransaction mapeia despesa (negativo → expense)", () => {
    const tx = csvRowToTransaction(
      { Data: "05/06/2026", Valor: "-35,00", Hist: "iFood" },
      { dateColumn: "Data", amountColumn: "Valor", descriptionColumn: "Hist",
        dateFormat: "DD/MM/YYYY", decimalSeparator: ",", expenseIsNegative: true },
      "acc1",
    );
    expect(tx.type).toBe("expense");
    expect(tx.amountCents).toBe(3500);
    expect(tx.date).toBe("2026-06-05");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementação** — `packages/shared/src/import.ts`:
```ts
import { z } from "zod";

export const csvMappingSchema = z.object({
  dateColumn: z.string(),
  amountColumn: z.string(),
  descriptionColumn: z.string().nullish(),
  dateFormat: z.enum(["DD/MM/YYYY","YYYY-MM-DD","MM/DD/YYYY"]).default("DD/MM/YYYY"),
  decimalSeparator: z.enum([",","."]).default(","),
  expenseIsNegative: z.boolean().default(true),
});
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export function parseBrDate(raw: string, fmt: CsvMapping["dateFormat"]): string {
  const s = raw.trim();
  if (fmt === "YYYY-MM-DD") return s;
  const [a, b, c] = s.split(/[\/\-.]/);
  return fmt === "DD/MM/YYYY" ? `${c}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`
                              : `${c}-${a.padStart(2,"0")}-${b.padStart(2,"0")}`;
}

export function parseAmountCents(raw: string, decimal: "," | "."): number {
  let s = raw.trim().replace(/\s/g, "");
  if (decimal === ",") s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  return Math.round(parseFloat(s) * 100);
}

export function importFingerprint(accountId: string, dateISO: string, amountCents: number, desc?: string | null): string {
  const norm = (desc ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  return `${accountId}|${dateISO}|${amountCents}|${norm}`;
}

export function csvRowToTransaction(row: Record<string,string>, m: CsvMapping, accountId: string) {
  const signed = parseAmountCents(row[m.amountColumn], m.decimalSeparator);
  const isExpense = m.expenseIsNegative ? signed < 0 : signed > 0;
  const dateISO = parseBrDate(row[m.dateColumn], m.dateFormat);
  const description = m.descriptionColumn ? row[m.descriptionColumn] ?? null : null;
  return {
    type: isExpense ? "expense" as const : "income" as const,
    amountCents: Math.abs(signed),
    date: dateISO,
    accountId,
    description,
    fingerprint: importFingerprint(accountId, dateISO, Math.abs(signed) * (isExpense?-1:1), description),
  };
}
```

- [ ] **Step 4: Reexportar** (`export * from "./import";`) e **ver passar**.

- [ ] **Step 5: Commit** — `git commit -am "feat(shared): csv mapping schema, date/amount parsers and import fingerprint"`

---

## Task 3: CSV — preview

**Files:** Create `apps/api/src/import/import.controller.ts`, `import.service.ts`, `import.module.ts`. Test: `apps/api/test/e2e/import-csv-preview.e2e.test.ts`.

**Interfaces:** Produces `POST /import/csv/preview` (multipart: arquivo + `accountId` + `mapping`) → `{ batchId, rows:[{...tx, dup:boolean}], rowCount, dupCount }`. Consumido pela web e pelo commit (Task 4).

- [ ] **Step 1: e2e (falha primeiro)** — sobe um CSV de 3 linhas (1 já existente no banco → `dup:true`); espera `rowCount=3`, `dupCount=1`, e a flag certa por linha.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Service (preview)** — `apps/api/src/import/import.service.ts` (núcleo):
```ts
import Papa from "papaparse";
import { Injectable } from "@nestjs/common";
import { csvMappingSchema, csvRowToTransaction } from "@app/shared";
import { clientFromToken } from "../supabase/supabase-request";

@Injectable()
export class ImportService {
  async csvPreview(token: string, userId: string, accountId: string, mappingRaw: unknown, csv: string) {
    const mapping = csvMappingSchema.parse(mappingRaw);
    const sb = clientFromToken(token);
    const { data: ws } = await sb.from("workspaces").select("id").limit(1).single();

    const parsed = Papa.parse<Record<string,string>>(csv, { header: true, skipEmptyLines: true });
    const txs = parsed.data.map(r => csvRowToTransaction(r, mapping, accountId));

    const fps = txs.map(t => t.fingerprint);
    const { data: existing } = await sb.from("transactions")
      .select("import_fingerprint").in("import_fingerprint", fps);
    const seen = new Set((existing ?? []).map(e => e.import_fingerprint));

    const rows = txs.map(t => ({ ...t, dup: seen.has(t.fingerprint) }));
    const dupCount = rows.filter(r => r.dup).length;

    const { data: batch } = await sb.from("import_batches").insert({
      workspace_id: ws!.id, account_id: accountId, format: "csv",
      status: "preview", row_count: rows.length, dup_count: dupCount, created_by: userId,
    }).select().single();

    return { batchId: batch!.id, rows, rowCount: rows.length, dupCount };
  }
}
```
Controller `POST /import/csv/preview` recebe multipart (usar `@fastify/multipart`), lê o arquivo como texto e delega.

- [ ] **Step 4: Rodar e ver passar.**

- [ ] **Step 5: Commit** — `git commit -am "feat(import): CSV preview with mapping and dedup flags"`

---

## Task 4: CSV/OFX — commit idempotente

**Files:** Modify `apps/api/src/import/*`. Test: `apps/api/test/e2e/import-commit.e2e.test.ts`.

**Interfaces:** Produces `POST /import/:batchId/commit` (body: linhas selecionadas) → insere transações confirmadas com idempotência; recommit não duplica.

- [ ] **Step 1: e2e idempotência (falha primeiro)** — commit do lote insere N transações; **segundo commit** do mesmo conjunto insere **0** novas (fingerprint colide) e o saldo não muda.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Service (commit)** — em `import.service.ts`:
```ts
async commit(token: string, userId: string, batchId: string, rows: Array<{
  type: "income"|"expense"; amountCents: number; date: string;
  accountId: string; description: string | null; categoryId?: string | null; fingerprint: string;
}>) {
  const sb = clientFromToken(token);
  const { data: ws } = await sb.from("workspaces").select("id").limit(1).single();

  const payload = rows.map(r => ({
    workspace_id: ws!.id, type: r.type, amount_cents: r.amountCents, date: r.date,
    account_id: r.accountId, category_id: r.categoryId ?? null,
    description: r.description, source: "import",
    import_fingerprint: r.fingerprint, import_batch_id: batchId, created_by: userId,
  }));

  // idempotente: ignora os que já existem (índice único parcial)
  const { data, error } = await sb.from("transactions")
    .upsert(payload, { onConflict: "workspace_id,import_fingerprint", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;

  await sb.from("import_batches").update({ status: "committed" }).eq("id", batchId);
  return { inserted: data?.length ?? 0 };
}
```
> `upsert(..., ignoreDuplicates: true)` sobre o índice único parcial dá o `ON CONFLICT DO NOTHING`.

- [ ] **Step 4: Rodar e ver passar.**

- [ ] **Step 5: Commit** — `git commit -am "feat(import): idempotent commit of CSV/OFX rows as confirmed transactions"`

---

## Task 5: OFX — parse com FITID

**Files:** Create `packages/shared/src/ofx.ts` (parser puro); endpoint `POST /import/ofx/preview`. Test: `packages/shared/src/__tests__/ofx.test.ts`.

**Interfaces:** Produces `parseOfx(text)` → `[{ fitid, dateISO, amountCents, memo }]`; preview reusa o fluxo da Task 3 com fingerprint `ofx:{accountId}:{fitid}`.

- [ ] **Step 1: Teste (falha primeiro)** — `ofx.test.ts`: dado um trecho OFX com 2 `<STMTTRN>`, `parseOfx` retorna 2 itens com `fitid`, `amountCents` (sinal correto) e `dateISO` a partir de `DTPOSTED` (`YYYYMMDD...`).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Parser** — `packages/shared/src/ofx.ts`:
```ts
export type OfxTxn = { fitid: string; dateISO: string; amountCents: number; memo: string | null };

export function parseOfx(text: string): OfxTxn[] {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string) => {
    const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, "i"));
    return m ? m[1].trim() : null;
  };
  return blocks.map(b => {
    const dt = tag(b, "DTPOSTED") ?? "";
    const dateISO = `${dt.slice(0,4)}-${dt.slice(4,6)}-${dt.slice(6,8)}`;
    const amt = parseFloat((tag(b, "TRNAMT") ?? "0").replace(",", "."));
    return {
      fitid: tag(b, "FITID") ?? `${dateISO}-${amt}`,
      dateISO,
      amountCents: Math.round(amt * 100),
      memo: tag(b, "MEMO") ?? tag(b, "NAME"),
    };
  });
}
```

- [ ] **Step 4: Ver passar.**

- [ ] **Step 5: Endpoint preview OFX** — `POST /import/ofx/preview`: parseia, mapeia `amountCents<0 → expense`, fingerprint `ofx:{accountId}:{fitid}`, mesma checagem de dup e `import_batches` (format `ofx`). Reusa `commit` da Task 4.

- [ ] **Step 6: Commit** — `git commit -am "feat(import): OFX parser with FITID-based idempotency"`

---

## Task 6: Fatura PDF → IA → múltiplos rascunhos

**Files:** Create `apps/worker/src/import/pdf.processor.ts`; endpoint `POST /import/pdf`. Test: `apps/worker/test/import-pdf.test.ts`.

**Interfaces:** Consumes fila `ai` e os gateways da Fase 2. Produces job `import.parse_pdf` que extrai **várias** linhas do PDF e grava N `transaction_drafts` (revisão da Fase 2). Reusa o bucket `receipts`.

- [ ] **Step 1: Teste mockado (falha primeiro)** — `import-pdf.test.ts`: `pdf-parse` mockado retorna texto; um `parseInvoice` (no gateway) mockado retorna 3 linhas; espera 3 `transaction_drafts` gravados e `ai_jobs.status='done'`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Gateway multi-linha** — em `apps/worker/src/ai/openrouter.ts` adicionar `parseInvoiceText(text)` que pede um **array** de transações (schema array) e valida cada item com `extractedDraftSchema`.

- [ ] **Step 4: Processor** — `apps/worker/src/import/pdf.processor.ts`: baixa o PDF do storage, extrai texto com `pdf-parse`, chama `parseInvoiceText`, mapeia categorias e **insere N drafts** (`kind='parse_image'` ou novo `kind`), atualiza `ai_jobs`. (Estrutura espelha o `ingest.processor` da Fase 2.)

- [ ] **Step 5: Endpoint** — `POST /import/pdf` recebe `{ storagePath }`, cria `ai_job` + `import_batch` (format `pdf`), enfileira `import.parse_pdf`.

- [ ] **Step 6: Rodar e ver passar.**

- [ ] **Step 7: Commit** — `git commit -am "feat(import): credit-card PDF invoice → AI extraction → review drafts"`

---

## Task 7: Web — assistente de importação

**Files:** Create `apps/web/src/views/ImportView.vue`, `components/CsvMapper.vue`. Test: `apps/web/src/components/__tests__/csv-mapper.test.ts`.

**Interfaces:** Consumes endpoints das Tasks 3–6. Produces o wizard: escolher formato + conta → (CSV) mapear colunas → preview com flags de duplicata → commit; (PDF) envia e cai na revisão.

- [ ] **Step 1: Teste do mapper (falha primeiro)** — dado o cabeçalho de um CSV, `CsvMapper` sugere colunas por heurística (ex.: coluna com datas → `dateColumn`) e emite um `mapping` válido por `csvMappingSchema`.

- [ ] **Step 2..5: Implementar e ver passar.** Wizard de 3 passos (formato/conta → mapeamento/preview → confirmação). Preview destaca duplicatas (desmarcadas por padrão). Salvar mapeamento nomeado (`import_mappings`) para reuso.

- [ ] **Step 6: Commit** — `git commit -am "feat(web): import wizard with CSV mapping, dedup preview and commit"`

---

## Self-review (feito)

- **Cobertura:** CSV (Tasks 2–4,7), OFX (Task 5), fatura PDF (Task 6) · idempotência provada (Task 4) · dedup no preview (Task 3) · reuso da revisão da Fase 2 (Task 6).
- **Parsers puros e determinísticos** em `@app/shared` → testes sem rede; só a fatura PDF toca IA (mockada).
- **Consistência:** transações importadas usam o mesmo schema/`CHECK` da Fase 1; saldo (Fase 1) e dashboard recalculam automaticamente.
- **Pontos de atenção:** (a) variedade de layouts de OFX/CSV de bancos BR — o parser cobre o caso comum; mapeamentos salvos absorvem a variação de CSV; (b) detecção de transferência entre contas no import fica para reconciliação futura (hoje vira duas linhas income/expense); (c) `@fastify/multipart` precisa ser registrado no bootstrap do Nest.

---

## Execução

`subagent-driven`. Dependências: 1 → 2 → (3,5) → 4 → 6 → 7. Tasks 2 e 5 (parsers puros) são as de maior densidade de teste; Task 4 carrega o DoD de idempotência.

---

> **Próxima:** Fase 4 (Inteligência) — categorização que aprende com correções, detecção de anomalias/assinaturas, previsão de saldo, orçamentos (50/30/20) e metas/cofrinhos. Tem decisões de design (sobretudo o mecanismo de aprendizado de categoria: regras + few-shot por workspace vs embeddings) que eu travo com recomendação no plano.
