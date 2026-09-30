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
