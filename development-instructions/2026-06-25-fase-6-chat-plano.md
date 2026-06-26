# Fase 6 — Chat "Pergunte às suas finanças" · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` ou `superpowers:executing-plans`. Steps em checkbox.
>
> **Convenção:** scaffolding por comandos; código autoral por completo. LLM mockado nos testes (seleção de função determinística). Reusa serviços das Fases 1/4 e o `@WorkspaceId()` da Fase 5. Repo: `docs/superpowers/plans/2026-06-25-fase-6-chat.md`.

**Goal:** Responder perguntas em linguagem natural sobre as finanças do workspace ativo, com **function calling** sobre um conjunto **whitelisted** de consultas seguras; respostas com texto e gráfico montado a partir de dados estruturados.

**Architecture:** Pergunta → orquestrador chama OpenRouter com as definições das ferramentas → modelo escolhe função(ões) + args → backend valida args (Zod) e executa a consulta correspondente **com o token do usuário e o `workspace_id` do contexto** (RLS) → resultado volta ao modelo → resposta final em pt-BR. Sem SQL gerado por modelo. `workspace_id` nunca vem do modelo.

**Tech Stack:** OpenRouter (tools), Zod, NestJS, Supabase (RLS), Vue + ECharts.

## Decisões registradas (travadas)

| # | Tema | Decisão |
|---|---|---|
| 1 | Acesso a dados | **Function calling** sobre funções whitelisted. **Sem** text-to-SQL livre. |
| 2 | Escopo | `workspace_id` e token **sempre do contexto** da requisição; args do modelo nunca trazem escopo. |
| 3 | Nomes | Modelo fala por **nome** (categoria/conta); o executor resolve nome→id dentro do workspace (RLS). |
| 4 | Números | Vêm das funções determinísticas (Fases 1/4); o LLM só **redige**. |
| 5 | Gráfico | Montado pelo backend a partir do resultado estruturado; o modelo não escolhe números. |
| 6 | Histórico | Persistido (`chat_conversations`/`chat_messages`) por workspace. |

## Global Constraints

- Toda ferramenta valida args com Zod; ferramenta desconhecida → erro devolvido ao modelo, nunca execução.
- Loop de tools com limite de iterações (evita laço infinito/custo).
- Migrations continuam (próxima: `0025`).

---

## Task 1: Registry de ferramentas (whitelist + executores)

**Files:** Create `apps/api/src/chat/tools.ts`. Test: `apps/api/test/e2e/chat-tools.e2e.test.ts`.

**Interfaces:** Produces `TOOLS` (nome → { schema Zod, definição JSON-schema, executor }). Executor: `(args, ctx:{token, workspaceId}) => Promise<unknown>`. Consumido pelo orquestrador (Task 3).

- [ ] **Step 1: e2e (falha primeiro)** — semeia dados; chama diretamente `TOOLS.get_category_spending.run({ month, type:'expense' }, ctx)` e espera o breakdown correto; `search_transactions` por `categoryName` resolve nome→id e filtra; conta de **outro** workspace passada por `accountName` retorna vazio (RLS).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementação** — `apps/api/src/chat/tools.ts`:
```ts
import { z } from "zod";
import { clientFromToken } from "../supabase/supabase-request";

type Ctx = { token: string; workspaceId: string };

const monthArg = z.object({ month: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

async function resolveCategoryId(ctx: Ctx, name?: string) {
  if (!name) return null;
  const sb = clientFromToken(ctx.token);
  const { data } = await sb.from("categories").select("id")
    .ilike("name", name).limit(1).maybeSingle();
  return data?.id ?? "___none___";   // força resultado vazio se não existir
}
async function resolveAccountId(ctx: Ctx, name?: string) {
  if (!name) return null;
  const sb = clientFromToken(ctx.token);
  const { data } = await sb.from("accounts").select("id")
    .ilike("name", name).limit(1).maybeSingle();
  return data?.id ?? "___none___";
}

export const TOOLS = {
  get_balance: {
    schema: z.object({}),
    def: { name: "get_balance", description: "Saldo consolidado e por conta do workspace ativo.",
           parameters: { type: "object", properties: {} } },
    async run(_a: unknown, ctx: Ctx) {
      const sb = clientFromToken(ctx.token);
      const { data } = await sb.from("account_balances").select("*");
      const consolidated = (data ?? []).reduce((s, b) => s + Number(b.balance_cents), 0);
      return { accounts: data, consolidatedCents: consolidated };
    },
  },
  get_cashflow: {
    schema: monthArg,
    def: { name: "get_cashflow", description: "Receita e despesa de um mês (YYYY-MM-01).",
           parameters: { type: "object", properties: { month: { type: "string" } }, required: ["month"] } },
    async run(a: { month: string }, ctx: Ctx) {
      const sb = clientFromToken(ctx.token);
      const { data } = await sb.rpc("month_cashflow", { p_workspace: ctx.workspaceId, p_month: a.month });
      return data?.[0] ?? { income_cents: 0, expense_cents: 0 };
    },
  },
  get_category_spending: {
    schema: monthArg.extend({ type: z.enum(["income","expense"]).default("expense") }),
    def: { name: "get_category_spending", description: "Gasto por categoria num mês.",
           parameters: { type: "object",
             properties: { month: { type: "string" }, type: { type: "string", enum: ["income","expense"] } },
             required: ["month"] } },
    async run(a: { month: string; type: "income"|"expense" }, ctx: Ctx) {
      const sb = clientFromToken(ctx.token);
      const { data } = await sb.rpc("month_category_breakdown",
        { p_workspace: ctx.workspaceId, p_month: a.month, p_type: a.type });
      return data ?? [];
    },
  },
  search_transactions: {
    schema: z.object({
      from: z.string().nullish(), to: z.string().nullish(),
      categoryName: z.string().nullish(), accountName: z.string().nullish(),
      q: z.string().nullish(), minAmountCents: z.number().int().nullish(), maxAmountCents: z.number().int().nullish(),
    }),
    def: { name: "search_transactions", description: "Busca transações por período, categoria, conta, texto ou valor.",
           parameters: { type: "object", properties: {
             from: { type: "string" }, to: { type: "string" },
             categoryName: { type: "string" }, accountName: { type: "string" },
             q: { type: "string" }, minAmountCents: { type: "integer" }, maxAmountCents: { type: "integer" },
           } } },
    async run(a: any, ctx: Ctx) {
      const sb = clientFromToken(ctx.token);
      const categoryId = await resolveCategoryId(ctx, a.categoryName);
      const accountId = await resolveAccountId(ctx, a.accountName);
      let q = sb.from("transactions").select("*").order("date", { ascending: false }).limit(50);
      if (a.from) q = q.gte("date", a.from);
      if (a.to) q = q.lte("date", a.to);
      if (categoryId) q = q.eq("category_id", categoryId);
      if (accountId) q = q.or(`account_id.eq.${accountId},source_account_id.eq.${accountId},dest_account_id.eq.${accountId}`);
      if (a.q) q = q.ilike("description", `%${a.q}%`);
      if (a.minAmountCents) q = q.gte("amount_cents", a.minAmountCents);
      if (a.maxAmountCents) q = q.lte("amount_cents", a.maxAmountCents);
      const { data } = await q;
      return data ?? [];
    },
  },
} as const;

export type ToolName = keyof typeof TOOLS;
export const TOOL_DEFS = Object.values(TOOLS).map(t => ({ type: "function", function: t.def }));
```
> `workspace_id` só entra via `ctx`; nenhum schema de ferramenta o aceita. Nomes inexistentes viram `___none___` ⇒ resultado vazio (nunca vaza nada).

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(chat): whitelisted query tools with workspace-scoped executors"`

---

## Task 2: Gateway de function calling (loop de tools)

**Files:** Create `apps/api/src/chat/chat.gateway.ts`. Test: `apps/api/test/e2e/chat-loop.e2e.test.ts`.

**Interfaces:** Produces `runChat(messages, ctx)` que conversa com OpenRouter, executa as tools escolhidas e devolve a resposta final + os resultados estruturados usados. Limite de iterações.

- [ ] **Step 1: Teste (falha primeiro)** — `fetch` mockado retorna, na 1ª chamada, um `tool_calls` para `get_cashflow`; na 2ª, a resposta final em texto. `runChat` deve executar a tool, reinjetar o resultado e retornar `{ answer, toolResults:[{name:'get_cashflow', result}] }`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementação** — `apps/api/src/chat/chat.gateway.ts`:
```ts
import { TOOLS, TOOL_DEFS, ToolName } from "./tools";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ITERS = 5;
const SYSTEM = "Você responde perguntas sobre as finanças do usuário em pt-BR. " +
  "Use SOMENTE as ferramentas disponíveis para obter números; nunca invente valores. " +
  "Se faltar dado, diga que não encontrou.";

export async function runChat(apiKey: string, model: string,
  history: Array<{ role: string; content: string }>, ctx: { token: string; workspaceId: string }) {
  const messages: any[] = [{ role: "system", content: SYSTEM }, ...history];
  const toolResults: Array<{ name: string; result: unknown }> = [];

  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: TOOL_DEFS, tool_choice: "auto" }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
    const data = await res.json();
    const msg = data.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { answer: msg.content ?? "", toolResults };
    }
    for (const call of msg.tool_calls) {
      const name = call.function.name as ToolName;
      const tool = TOOLS[name];
      let content: unknown;
      if (!tool) {
        content = { error: `ferramenta desconhecida: ${name}` };       // nunca executa
      } else {
        try {
          const args = tool.schema.parse(JSON.parse(call.function.arguments || "{}"));
          const result = await tool.run(args as any, ctx);             // ctx força o escopo
          toolResults.push({ name, result });
          content = result;
        } catch (e) { content = { error: String(e) }; }
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(content) });
    }
  }
  return { answer: "Não consegui concluir a consulta.", toolResults };
}
```

- [ ] **Step 4: Ver passar e commit** — `git commit -am "feat(chat): OpenRouter function-calling loop with iteration cap"`

---

## Task 3: Endpoint de chat + montagem de gráfico

**Files:** Create `apps/api/src/chat/chat.controller.ts`, `chat.service.ts`, `chart.ts`. Test: `apps/api/test/e2e/chat.e2e.test.ts`.

**Interfaces:** Produces `POST /chat { message, conversationId? }` → `{ answer, chart?, toolResults }`. `chart` derivado **deterministicamente** do `toolResults`.

- [ ] **Step 1: e2e (falha primeiro)** — com LLM mockado escolhendo `get_category_spending`, a resposta traz `answer` (texto) e `chart` do tipo `pie` com as fatias = breakdown retornado pela tool (números batem com os dados semeados).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Montagem de gráfico** — `apps/api/src/chat/chart.ts`: mapeia `toolResults` → spec de gráfico determinístico (`get_category_spending`→pie; `get_cashflow_series`→line; `get_cashflow`→bar). Sem LLM.

- [ ] **Step 4: Service/controller** — `POST /chat` usa `@WorkspaceId()`, chama `runChat`, monta `chart`, devolve. (Persistência na Task 5.)

- [ ] **Step 5: Ver passar e commit** — `git commit -am "feat(chat): chat endpoint with deterministic chart from tool results"`

---

## Task 4: Guardrails de segurança

**Files:** Modify testes. Test: `apps/api/test/e2e/chat-security.e2e.test.ts`. (Headline da fase.)

**Interfaces:** Garante que o chat não vaza dados fora do workspace ativo, por construção.

- [ ] **Step 1: e2e de segurança (falha primeiro se a implementação regredir)** — com LLM mockado **malicioso**:
  - emite `tool_calls` com nome `run_sql` (não-whitelisted) → o loop devolve erro ao modelo, **não executa** nada; resposta final não contém dados.
  - emite `get_category_spending` com um arg extra `workspace_id` de outro workspace → o arg é **ignorado** (schema não o aceita; escopo vem do `ctx`); resultado é do workspace do usuário.
  - `search_transactions` com `accountName` de conta de outro workspace → retorna **vazio** (resolve para `___none___`).
  - args malformados (`minAmountCents: "DROP TABLE"`) → Zod rejeita; vira erro tratado, sem 500.

- [ ] **Step 2: Rodar; ajustar até verde.** (A implementação das Tasks 1–2 já deve passar; estes testes **fixam** o contrato de segurança contra regressão.)

- [ ] **Step 3: Commit** — `git commit -am "test(chat): security guardrails — whitelist, scope and arg validation"`

---

## Task 5: Persistência de conversas

**Files:** Create `supabase/migrations/0025_chat.sql`; Modify `chat.service.ts`. Test: `apps/api/test/database/chat_history.test.ts`.

**Interfaces:** Produces `chat_conversations`/`chat_messages` (RLS por workspace); o `POST /chat` grava a troca e aceita `conversationId` pra continuar.

- [ ] **Step 1: Teste (falha primeiro)** — duas mensagens na mesma `conversationId` ficam ordenadas; isola por workspace.

- [ ] **Step 2: Migration** — `supabase/migrations/0025_chat.sql`: `chat_conversations`(id, workspace_id, title, created_by, created_at) e `chat_messages`(id, conversation_id, role, content, created_at) + RLS (`is_member` via join na conversa).

- [ ] **Step 3..4: Implementar e ver passar** — `POST /chat` cria/usa conversa, persiste user+assistant; `GET /chat/:conversationId` retorna histórico.

- [ ] **Step 5: Commit** — `git commit -am "feat(chat): persist conversations and messages with RLS"`

---

## Task 6: Web — interface de chat

**Files:** Create `apps/web/src/views/ChatView.vue`, `components/ChatChart.vue`. Test: `apps/web/src/components/__tests__/chat-chart.test.ts`.

**Interfaces:** Consumes `POST /chat`. Produces UI de conversa com bolhas, render de `chart` (ECharts) a partir do spec, e histórico.

- [ ] **Step 1: Teste do chart (falha primeiro)** — dado um spec `pie`, `ChatChart` monta as séries esperadas do ECharts.

- [ ] **Step 2..4: Implementar e ver passar** — caixa de pergunta, streaming/loading, bolhas, gráfico inline quando presente, lista de conversas (histórico). Sempre envia `X-Workspace-Id` do workspace ativo (Fase 5).

- [ ] **Step 5: Commit** — `git commit -am "feat(web): chat UI with inline charts and history"`

---

## Self-review (feito)

- **Cobertura:** ferramentas whitelisted (Task 1), loop de function calling (Task 2), endpoint+gráfico (Task 3), **guardrails** (Task 4), histórico (Task 5), UI (Task 6).
- **Segurança por construção:** escopo só do `ctx`; ferramenta desconhecida não executa; nomes→id via RLS; args via Zod; limite de iterações. A Task 4 fixa isso contra regressão.
- **Determinismo:** números e gráficos vêm das tools/Fases 1/4; o LLM só redige.
- **Pontos de atenção:** (a) escolher no OpenRouter um modelo com bom suporte a tools; (b) `MAX_ITERS` e tamanho de histórico controlam custo — ajustáveis por env; (c) considerar truncar o histórico enviado em conversas longas.

---

## Execução

`subagent-driven`. Dependências: 1 → 2 → 3 → 4 → 5 → 6. A **Task 4 (guardrails)** é inegociável: não fechar a fase sem ela verde.

---

> **Próxima:** Fase 7 (Open Finance). Decisão que vou travar: **agregador via Pluggy** (cobertura e DX no mercado BR) atrás de uma interface `AggregatorGateway` — para não acoplar ao provedor e poder trocar por Belvo sem reescrever o domínio; fluxo de consentimento, sync e conciliação com lançamentos manuais/IA (reusa o fingerprint da Fase 3).
