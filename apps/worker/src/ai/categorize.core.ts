import {
  categoryFits, chunk, decideAiResult, detectTransferPairs, isCatchAllCategoryName, matchRule, rankBySimilarity, redactForLlm,
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
  /** Lotes em que o gateway de IA falhou (as linhas do lote ficam pendentes). */
  aiFailures: number;
  /** Linhas que passaram do teto de IA do job: só ganham reviewStatus pending (sem tocar na sugestão existente). */
  deferred: number;
  deferredIds: string[];
}

const MAX_EXAMPLES = 30;
/** Teto de linhas enviadas à IA por job (as mais recentes); o excedente só vira pendência (deferredIds). */
export const MAX_AI_ROWS_PER_JOB = 500;

export const CATEGORIZE_SYSTEM =
  "Você classifica lançamentos financeiros brasileiros. Para cada lançamento, escolha UMA categoria da lista, " +
  "respeitando o tipo (income/expense). Se não tiver certeza, use categoryId null. " +
  "Prefira categoryId null a uma categoria genérica (como \"Outras despesas\") quando a descrição não trouxer informação. " +
  "Informe a confiança de 0 a 1. Responda SOMENTE com o JSON do schema.";

export const txText = (tx: { counterparty: string | null; description: string | null }) =>
  [tx.counterparty, tx.description].filter(Boolean).join(" ");

/** Texto que sai do sistema rumo ao LLM: documentos e sequências longas de dígitos mascarados. */
const llmText = (tx: { counterparty: string | null; description: string | null }) => redactForLlm(txText(tx));

function buildUserPrompt(batch: CatTx[], categories: CatCategory[], examples: CatExample[]): string {
  return JSON.stringify({
    categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    examples: examples.map((e) => ({ descricao: redactForLlm(e.text), categoria: e.categoryName })),
    transactions: batch.map((t) => ({
      id: t.id,
      descricao: llmText(t),
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
  const plan: CategorizePlan = { transferPairs: [], byRule: [], byAi: [], pending: [], costTokens: 0, aiFailures: 0, deferred: 0, deferredIds: [] };
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

  // 3. IA em lote, uma entidade por vez; só as MAX_AI_ROWS_PER_JOB linhas mais recentes vão à IA (sort estável).
  const byRecency = [...remaining].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const forAi = byRecency.slice(0, MAX_AI_ROWS_PER_JOB);
  const deferred = byRecency.slice(MAX_AI_ROWS_PER_JOB);
  const batchSize = Math.max(1, Math.floor(Number.isFinite(settings.aiBatchSize) ? settings.aiBatchSize : 40));
  const byEntity = new Map<AccountEntity | null, CatTx[]>();
  for (const tx of forAi) {
    const group = byEntity.get(tx.accountEntity);
    if (group) group.push(tx);
    else byEntity.set(tx.accountEntity, [tx]);
  }

  for (const [entity, txs] of byEntity) {
    const offered = categories.filter((c) => !entity || c.entity === "both" || c.entity === entity);
    const sameEntityExamples = examples.filter((e) => !entity || e.entity === entity);
    for (const batch of chunk(txs, batchSize)) {
      const target = batch.map(txText).join(" ");
      const shots = rankBySimilarity(sameEntityExamples, (e) => e.text, target, MAX_EXAMPLES);
      let results: AiBatchResult[] | null = null;
      try {
        const out = await ai.categorizeBatch({ system: CATEGORIZE_SYSTEM, user: buildUserPrompt(batch, offered, shots) });
        results = out.results;
        plan.costTokens += out.costTokens ?? 0;
      } catch {
        results = null; // falha da IA nunca derruba o job: o lote inteiro fica pendente
        plan.aiFailures++;
      }
      const byId = new Map((results ?? []).map((r) => [r.transactionId, r]));
      for (const tx of batch) {
        const decision = decideAiResult(byId.get(tx.id), (id) => fits(id, tx), settings.aiConfidenceThreshold);
        if (decision.status === "ok" && isCatchAllCategoryName(catById.get(decision.categoryId)?.name)) {
          // Categoria "pega-tudo" (por nome; todas as de fábrica são isSystem) nunca é aplicada pela IA: vira pendência com a sugestão registrada.
          plan.pending.push({ txId: tx.id, suggestedCategoryId: decision.categoryId, confidence: decision.confidence });
        } else if (decision.status === "ok") {
          plan.byAi.push({ txId: tx.id, categoryId: decision.categoryId, confidence: decision.confidence });
        } else {
          plan.pending.push({ txId: tx.id, suggestedCategoryId: decision.suggestedCategoryId, confidence: decision.confidence });
        }
      }
    }
  }

  plan.deferredIds = deferred.map((t) => t.id);
  plan.deferred = deferred.length;

  return plan;
}
