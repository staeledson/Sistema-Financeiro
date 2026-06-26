import { TOOLS, TOOL_DEFS, ToolName, Ctx } from "./tools";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ITERS = 5;
const SYSTEM =
  "Você é um assistente financeiro pessoal que responde em pt-BR. " +
  "Use SOMENTE as ferramentas disponíveis para obter números e dados; nunca invente valores. " +
  "Se faltar dado, diga que não encontrou. Seja conciso e direto.";

export interface ToolResult {
  name: string;
  result: unknown;
}

export interface ChatResponse {
  answer: string;
  toolResults: ToolResult[];
}

export type FetchFn = typeof fetch;

export async function runChat(
  apiKey: string,
  model: string,
  history: Array<{ role: string; content: string }>,
  ctx: Ctx,
  fetchFn: FetchFn = fetch,
): Promise<ChatResponse> {
  const messages: unknown[] = [{ role: "system", content: SYSTEM }, ...history];
  const toolResults: ToolResult[] = [];

  for (let i = 0; i < MAX_ITERS; i++) {
    const res = await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: TOOL_DEFS, tool_choice: "auto" }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices: Array<{ message: { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
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
        content = { error: `ferramenta desconhecida: ${name}` };
      } else {
        try {
          const rawArgs = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
          // workspaceId never comes from model args — always from ctx
          delete rawArgs["workspaceId"];
          delete rawArgs["workspace_id"];
          const args = tool.schema.parse(rawArgs);
          const result = await (tool as { run: (a: unknown, ctx: Ctx) => Promise<unknown> }).run(args, ctx);
          toolResults.push({ name, result });
          content = result;
        } catch (e) {
          content = { error: String(e) };
        }
      }

      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(content) });
    }
  }

  return { answer: "Não consegui concluir a consulta.", toolResults };
}
