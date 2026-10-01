import { z } from "zod";
import type { AccountEntity, AccountType, CategoryEntity, TransactionType } from "./enums";

export function foldText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Categorias "pega-tudo" de fábrica: a IA pode sugeri-las, mas nunca as aplica sozinha. */
export const CATCH_ALL_EXPENSE_NAME = "Outras despesas";
export const CATCH_ALL_INCOME_NAME = "Outras receitas";
export const CATCH_ALL_CATEGORY_NAMES: readonly string[] = [CATCH_ALL_EXPENSE_NAME, CATCH_ALL_INCOME_NAME];

/** Compara o nome por `foldText` (sem acento nem caixa, espaços aparados). */
export function isCatchAllCategoryName(name: string | null | undefined): boolean {
  const folded = foldText((name ?? "").trim());
  return CATCH_ALL_CATEGORY_NAMES.some((n) => foldText(n) === folded);
}

/**
 * Chave de agrupamento de descrições: minúsculas, sem acentos, sem dígitos nem pontuação, espaços colapsados.
 * Descrições feitas só de dígitos/pontuação resultam em chave vazia; quem chama deve tratar a chave vazia como
 * "não agrupável" (usar o texto bruto no lugar).
 */
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
  if (!result || categoryId === null || !Number.isFinite(result.confidence) || !isValidCategory(categoryId)) {
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
  /** Data `YYYY-MM-DD`; um timestamp ISO mais longo é truncado para a data. */
  date: string;
  text: string;
}

const CARD_PAYMENT = /pgto\.?\s*fat|pagamento\s+(de\s+)?fatura|pag\.?\s*fatura/;
const STARTS_WITH_PAYMENT = /^pagamento\b|^inclusao de pagamento\b/;

/**
 * Texto de pagamento de fatura de cartão (`pgto fat…`, `pagamento (de) fatura`, `pag fatura`), que começa com
 * "pagamento" ou "inclusão de pagamento" (os dois rótulos que o C6 usa, conforme o mês). Pensado para linhas
 * negativas de conta de cartão, onde isso é o pagamento da fatura.
 */
export function isCardPaymentText(text: string | null | undefined): boolean {
  const folded = foldText(text ?? "").trim();
  return CARD_PAYMENT.test(folded) || STARTS_WITH_PAYMENT.test(folded);
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

function normalizeWords(text: string): string {
  return foldText(text).replace(/[^a-z0-9]+/g, " ").trim();
}

/** Nome do titular como palavra inteira (ignora nomes com menos de 3 caracteres após normalizar). */
function mentionsOwner(normalizedText: string, normalizedOwners: string[]): boolean {
  const haystack = ` ${normalizedText} `;
  return normalizedOwners.some((name) => haystack.includes(` ${name} `));
}

interface Prepared {
  c: TransferCandidate;
  index: number;
  day: number;
  owner: boolean;
  cardText: boolean;
}

/**
 * Pares de transferência interna `[despesaId, receitaId]`: contas diferentes, mesmo valor, sentidos opostos,
 * datas a no máximo `windowDays` e um sinal textual (nome do titular/empresa ou pagamento de fatura com uma conta
 * de cartão). Cada lançamento entra em no máximo um par; vence a contraparte mais próxima no tempo.
 * Lançamentos com data inválida nunca pareiam.
 */
export function detectTransferPairs(
  candidates: TransferCandidate[],
  opts: { ownerNames: string[]; windowDays: number },
): Array<[string, string]> {
  const owners = opts.ownerNames.map(normalizeWords).filter((n) => n.length >= 3);

  const byAmount = new Map<number, Prepared[]>();
  for (const c of candidates) {
    const day = dayNumber(c.date);
    if (!Number.isFinite(day)) continue;
    const item: Prepared = {
      c,
      index: 0,
      day,
      owner: mentionsOwner(normalizeWords(c.text), owners),
      cardText: CARD_PAYMENT.test(foldText(c.text)),
    };
    const group = byAmount.get(c.amountCents);
    if (group) group.push(item);
    else byAmount.set(c.amountCents, [item]);
  }

  const edges: Array<{ expense: TransferCandidate; income: TransferCandidate; days: number; g: number; i: number; j: number }> = [];
  let g = 0;
  for (const group of byAmount.values()) {
    group.forEach((p, idx) => { p.index = idx; });
    const sorted = [...group].sort((x, y) => x.day - y.day || x.index - y.index);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        const days = b.day - a.day;
        if (days > opts.windowDays) break;
        if (a.c.accountId === b.c.accountId || a.c.type === b.c.type) continue;
        const card =
          (a.c.accountType === "credit_card" || b.c.accountType === "credit_card") &&
          (a.cardText || b.cardText);
        if (!a.owner && !b.owner && !card) continue;
        const [expense, income] = a.c.type === "expense" ? [a.c, b.c] : [b.c, a.c];
        edges.push({ expense, income, days, g, i: Math.min(a.index, b.index), j: Math.max(a.index, b.index) });
      }
    }
    g++;
  }

  edges.sort((x, y) => x.days - y.days || x.g - y.g || x.i - y.i || x.j - y.j);
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
