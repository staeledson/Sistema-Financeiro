import { extractedDraftSchema, type ExtractedDraft, DRAFT_JSON_SCHEMA, invoiceLineSchema, type InvoiceLine, INVOICE_JSON_SCHEMA } from "./draft-schema";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const SYSTEM =
  "Você extrai UMA transação financeira do input do usuário em pt-BR. " +
  "amountCents é inteiro em centavos. date em YYYY-MM-DD (assuma o ano atual se ausente). " +
  "Responda SOMENTE com o JSON do schema.";

export class OpenRouterGateway {
  constructor(
    private readonly apiKey: string,
    private readonly visionModel: string,
    private readonly textModel: string,
  ) {}

  private async call(model: string, content: unknown) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
        response_format: { type: "json_schema", json_schema: DRAFT_JSON_SCHEMA },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = this.repairParse(raw);
    const draft: ExtractedDraft = extractedDraftSchema.parse(parsed);
    return { draft, costTokens: (data.usage?.total_tokens ?? null) as number | null };
  }

  private repairParse(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
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

  async parseInvoiceText(text: string): Promise<{ lines: InvoiceLine[]; costTokens: number | null }> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.textModel,
        messages: [
          {
            role: "system",
            content:
              "Você extrai TODAS as transações financeiras de uma fatura ou extrato em pt-BR. " +
              "amountCents é inteiro em centavos (sempre positivo). date em YYYY-MM-DD. " +
              "type: income para créditos/pagamentos recebidos, expense para cobranças/débitos. " +
              "Responda SOMENTE com o JSON do schema.",
          },
          { role: "user", content: text },
        ],
        response_format: { type: "json_schema", json_schema: INVOICE_JSON_SCHEMA },
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const raw: string = data.choices?.[0]?.message?.content ?? '{"transactions":[]}';
    const parsed = this.repairParse(raw) as { transactions?: unknown[] };
    const lines = (parsed.transactions ?? []).map((item) => invoiceLineSchema.parse(item));
    return { lines, costTokens: (data.usage?.total_tokens ?? null) as number | null };
  }
}
