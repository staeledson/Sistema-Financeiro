<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from "vue";
import { http } from "../lib/http";
import { useFinanceStore } from "../stores/finance";
import { ENTITY_SHORT, accountsForEntity, type EntityFilter } from "../lib/entity";
import { formatDate as formatDateOnly } from "../lib/import-client";
import {
  acceptSuggestions, categorizeGroup, categoriesForGroup, getPending, getTransferCandidates,
  ignoreTransactions, markTransfer, recategorize,
  type PendingGroup, type PendingResponse, type TransferCandidate,
} from "../lib/review-client";
import RulesPanel from "../components/RulesPanel.vue";

const finance = useFinanceStore();

// ───── pendentes de categoria ─────
const pending = ref<PendingResponse>({ total: 0, groups: [] });
const entityFilter = ref<EntityFilter>("all");
const accountFilter = ref("");
const showRules = ref(false);
const erro = ref("");
const info = ref("");
const busy = ref(false);

interface GroupUi {
  categoryId: string;
  createRule: boolean;
  applyToSimilar: boolean;
  transferOpen: boolean;
  candidates: TransferCandidate[];
  counterpartId: string;
}
const ui = reactive<Record<string, GroupUi>>({});

const filterAccounts = computed(() => accountsForEntity(finance.accounts, entityFilter.value));

// Respostas fora de ordem (filtros trocados rápido) não podem sobrescrever a mais recente.
let pendingSeq = 0;

async function loadPending() {
  const seq = ++pendingSeq;
  const res = await getPending({
    entity: entityFilter.value === "all" ? undefined : entityFilter.value,
    accountId: accountFilter.value || undefined,
  });
  if (seq !== pendingSeq) return;
  // O estado de cada grupo nasce aqui (e não no render) e some junto com o grupo.
  const keys = new Set(res.groups.map((g) => g.key));
  for (const k of Object.keys(ui)) if (!keys.has(k)) delete ui[k];
  for (const g of res.groups) {
    if (!ui[g.key]) {
      ui[g.key] = {
        categoryId: g.suggestedCategoryId ?? "",
        createRule: true,
        applyToSimilar: true,
        transferOpen: false,
        candidates: [],
        counterpartId: "",
      };
    }
  }
  pending.value = res;
}

/** Recarrega a lista (filtros, montagem) mostrando o erro na tela em vez de estourar. */
async function refresh() {
  try {
    await loadPending();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

/** Executa uma ação sobre os pendentes: sem cliques duplos, `busy` sempre liberado, lista recarregada no fim. */
async function run(action: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  erro.value = "";
  info.value = "";
  try {
    await action();
    await loadPending();
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

watch(entityFilter, () => {
  if (accountFilter.value && !filterAccounts.value.some((a) => a.id === accountFilter.value)) accountFilter.value = "";
});
watch([entityFilter, accountFilter], () => void refresh());

const categorize = (g: PendingGroup) => {
  const s = ui[g.key];
  if (!s.categoryId) {
    info.value = "";
    erro.value = "Escolha uma categoria.";
    return;
  }
  return run(async () => {
    const r = await categorizeGroup({
      transactionIds: g.transactionIds,
      categoryId: s.categoryId,
      createRule: s.createRule,
      applyToSimilar: s.applyToSimilar,
    });
    info.value = `${r.updated} lançamento(s) categorizado(s)${r.similarUpdated ? ` (${r.similarUpdated} parecidos)` : ""}${r.ruleCreated ? " e regra criada" : ""}.`;
  });
};
const accept = (g: PendingGroup) =>
  run(async () => {
    const r = await acceptSuggestions(g.transactionIds);
    info.value = `${r.accepted} sugestão(ões) aceita(s).`;
  });
const ignore = (g: PendingGroup) =>
  run(async () => {
    const r = await ignoreTransactions(g.transactionIds);
    info.value = `${r.ignored} lançamento(s) ignorado(s).`;
  });
const recat = () =>
  run(async () => {
    await recategorize();
    info.value = "Recategorização enfileirada. Volte em instantes.";
  });

async function openTransfer(g: PendingGroup) {
  const s = ui[g.key];
  s.transferOpen = !s.transferOpen;
  if (s.transferOpen && g.count === 1) {
    erro.value = "";
    try {
      s.candidates = await getTransferCandidates(g.transactionIds[0]);
    } catch (e) {
      erro.value = (e as Error).message;
    }
  }
}
const confirmTransfer = (g: PendingGroup) => {
  const s = ui[g.key];
  if (!s.counterpartId) {
    info.value = "";
    erro.value = "Escolha a contraparte.";
    return;
  }
  return run(async () => {
    await markTransfer(g.transactionIds[0], s.counterpartId);
    info.value = "Transferência marcada.";
  });
};

const suggestedName = (id: string | null) => finance.categories.find((c) => c.id === id)?.name ?? null;

// ───── rascunhos (comportamento original) ─────
interface Draft {
  id: string;
  kind: string;
  type: string | null;
  amountCents: number | null;
  date: string | null;
  description: string | null;
  counterparty: string | null;
  suggestedCategory: string | null;
  categoryId: string | null;
  confidence: number | null;
}

const drafts = ref<Draft[]>([]);
const draftErro = ref("");

// per-draft overrides
const overrides = ref<Record<string, { accountId: string; categoryId: string }>>({});

async function loadDrafts() {
  drafts.value = await http<Draft[]>("GET", "/drafts");
  drafts.value.forEach((d) => {
    if (!overrides.value[d.id]) overrides.value[d.id] = { accountId: "", categoryId: d.categoryId ?? "" };
  });
}

onMounted(async () => {
  await Promise.all([finance.loadAccounts(), finance.loadCategories(), refresh(), loadDrafts()]);
});

async function confirm(draft: Draft) {
  draftErro.value = "";
  try {
    const ov = overrides.value[draft.id];
    await http("POST", `/drafts/${draft.id}/confirm`, {
      accountId: ov.accountId || null,
      categoryId: ov.categoryId || null,
    });
    await loadDrafts();
  } catch (e) {
    draftErro.value = (e as Error).message;
  }
}

async function discard(id: string) {
  await http("DELETE", `/drafts/${id}`);
  await loadDrafts();
}

function formatBRL(cents: number | null) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Datas só-dia ("YYYY-MM-DD") não podem passar por new Date(): em UTC-3 mostrariam o dia anterior.
function formatDate(iso: string | null) {
  if (!iso) return "—";
  return formatDateOnly(iso);
}

const confidenceColor = (c: number | null) =>
  !c ? "#555" : c >= 0.85 ? "#2ecc71" : c >= 0.65 ? "#f39c12" : "#e74c3c";
</script>

<template>
  <section class="review">
    <header class="head">
      <h2>Para categorizar <span class="counter">{{ pending.total }}</span></h2>
      <div class="head-actions">
        <button type="button" class="btn-secondary" :disabled="busy" @click="recat">Recategorizar pendentes</button>
        <button type="button" class="btn-secondary" @click="showRules = !showRules">{{ showRules ? "Ocultar regras" : "Regras" }}</button>
      </div>
    </header>

    <p v-if="erro" role="alert" class="error">{{ erro }}</p>
    <p v-if="info" role="status" class="info">{{ info }}</p>

    <RulesPanel v-if="showRules" />

    <div class="filters">
      <select v-model="entityFilter" aria-label="Entidade">
        <option value="all">PF e PJ</option>
        <option value="pf">Pessoa Física</option>
        <option value="pj">Pessoa Jurídica</option>
      </select>
      <select v-model="accountFilter" aria-label="Conta">
        <option value="">Todas as contas</option>
        <option v-for="a in filterAccounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
      </select>
    </div>

    <p v-if="!pending.groups.length" class="empty">Nada pendente de categoria.</p>

    <ul class="groups">
      <li v-for="g in pending.groups" :key="g.key" class="group">
        <div class="group-head">
          <strong class="group-desc">{{ g.description }}</strong>
          <span class="group-meta">{{ g.count }} lançamento(s) · {{ formatBRL(g.totalCents) }} · {{ g.type === "income" ? "receita" : "despesa" }}<template v-if="g.entity"> · {{ ENTITY_SHORT[g.entity] }}</template></span>
        </div>
        <p v-if="suggestedName(g.suggestedCategoryId)" class="suggested">IA sugere: {{ suggestedName(g.suggestedCategoryId) }}</p>

        <div v-if="ui[g.key]" class="group-actions">
          <select v-model="ui[g.key].categoryId" :aria-label="`Categoria de ${g.description}`">
            <option value="">— Categoria —</option>
            <option v-for="c in categoriesForGroup(finance.categories, g)" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <label class="check"><input v-model="ui[g.key].createRule" type="checkbox" /> Criar regra</label>
          <label class="check"><input v-model="ui[g.key].applyToSimilar" type="checkbox" /> Aplicar a parecidos</label>
          <button type="button" :disabled="busy" @click="categorize(g)">Categorizar</button>
          <button v-if="g.suggestedCategoryId" type="button" class="btn-secondary" :disabled="busy" @click="accept(g)">Aceitar sugestão</button>
          <button v-if="g.count === 1" type="button" class="btn-secondary" :disabled="busy" @click="openTransfer(g)">Marcar transferência</button>
          <button type="button" class="btn-secondary" :disabled="busy" @click="ignore(g)">Ignorar</button>
        </div>

        <div v-if="ui[g.key]?.transferOpen && g.count === 1" class="transfer">
          <p v-if="!ui[g.key].candidates.length" class="hint">Nenhuma contraparte encontrada (mesmo valor, outra conta, até 7 dias).</p>
          <template v-else>
            <select v-model="ui[g.key].counterpartId" :aria-label="`Contraparte de ${g.description}`">
              <option value="">— Contraparte —</option>
              <option v-for="c in ui[g.key].candidates" :key="c.id" :value="c.id">
                {{ formatDate(c.date) }} · {{ c.accountName ?? "—" }} · {{ formatBRL(c.amountCents) }} · {{ c.description ?? "—" }}
              </option>
            </select>
            <button type="button" :disabled="busy" @click="confirmTransfer(g)">Confirmar transferência</button>
          </template>
        </div>
      </li>
    </ul>

    <h2 class="drafts-title">Rascunhos</h2>

    <p v-if="drafts.length === 0" class="empty">Nenhum rascunho pendente.</p>
    <p v-if="draftErro" role="alert" class="error">{{ draftErro }}</p>

    <ul class="draft-list">
      <li v-for="d in drafts" :key="d.id" class="draft-item">
        <div class="draft-header">
          <span class="draft-type">{{ d.type ?? '?' }}</span>
          <span class="draft-amount">{{ formatBRL(d.amountCents) }}</span>
          <span class="draft-date">{{ formatDate(d.date) }}</span>
          <span class="confidence" :style="{ color: confidenceColor(d.confidence) }">
            {{ d.confidence != null ? `${Math.round(d.confidence * 100)}%` : '?' }}
          </span>
        </div>

        <p class="draft-desc">{{ d.description ?? '—' }} <span v-if="d.counterparty">· {{ d.counterparty }}</span></p>
        <p v-if="d.suggestedCategory" class="suggested-cat">IA sugere: {{ d.suggestedCategory }}</p>

        <div class="draft-actions">
          <select v-if="overrides[d.id]" v-model="overrides[d.id].accountId" aria-label="Conta do rascunho">
            <option value="">— Conta —</option>
            <option v-for="a in finance.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <select v-if="overrides[d.id]" v-model="overrides[d.id].categoryId" aria-label="Categoria do rascunho">
            <option value="">— Categoria —</option>
            <option
              v-for="c in finance.categories.filter(cat => !d.type || cat.type === d.type)"
              :key="c.id"
              :value="c.id"
            >{{ c.name }}</option>
          </select>
          <button type="button" @click="confirm(d)" :disabled="!overrides[d.id]?.accountId && d.type !== 'transfer'">Confirmar</button>
          <button type="button" class="btn-discard" @click="discard(d.id)">Descartar</button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.review { padding: calc(var(--space) * 3); max-width: 720px; margin: 0 auto; }
h2 { margin-bottom: calc(var(--space) * 3); }
.draft-list { list-style: none; display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
.draft-item { background: var(--color-surface); border-radius: var(--radius); padding: calc(var(--space) * 3); display: flex; flex-direction: column; gap: calc(var(--space) * 1.5); }
.draft-header { display: flex; gap: calc(var(--space) * 2); align-items: center; flex-wrap: wrap; }
.draft-type { text-transform: uppercase; font-size: 0.75rem; letter-spacing: .05em; opacity: 0.7; }
.draft-amount { font-weight: 700; font-size: 1.1rem; }
.draft-date { font-size: 0.85rem; opacity: 0.6; }
.confidence { font-size: 0.8rem; font-weight: 600; }
.draft-desc { font-size: 0.95rem; }
.suggested-cat { font-size: 0.8rem; opacity: 0.6; font-style: italic; }
.draft-actions { display: flex; gap: var(--space); flex-wrap: wrap; align-items: center; margin-top: var(--space); }
.draft-actions > * { flex: 1; min-width: 120px; }
select { padding: calc(var(--space) * 1.2); border: 1px solid #333; border-radius: calc(var(--radius) / 2); background: var(--color-bg); color: var(--color-text); font-size: 0.9rem; }
button { padding: calc(var(--space) * 1.2) calc(var(--space) * 2); border: none; border-radius: calc(var(--radius) / 2); background: var(--color-primary); color: #fff; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }
.btn-discard { background: #555; }
.empty { opacity: 0.5; font-style: italic; }
.error { color: #e74c3c; }

.head { display: flex; justify-content: space-between; align-items: center; gap: calc(var(--space) * 2); flex-wrap: wrap; margin-bottom: calc(var(--space) * 3); }
.head h2 { margin: 0; }
.head-actions { display: flex; gap: var(--space); flex-wrap: wrap; }
.counter { display: inline-block; min-width: 1.6em; padding: 0 calc(var(--space) * 1); border-radius: 999px; background: var(--color-primary); color: #fff; font-size: 0.8rem; text-align: center; vertical-align: middle; }
.filters { display: flex; gap: var(--space); flex-wrap: wrap; margin-bottom: calc(var(--space) * 3); }
.groups { list-style: none; display: flex; flex-direction: column; gap: calc(var(--space) * 2); margin-bottom: calc(var(--space) * 4); }
.group { background: var(--color-surface); border-radius: var(--radius); padding: calc(var(--space) * 3); display: flex; flex-direction: column; gap: calc(var(--space) * 1.5); }
.group-head { display: flex; flex-direction: column; gap: calc(var(--space) * 0.5); }
.group-desc { font-size: 0.95rem; overflow-wrap: anywhere; }
.group-meta { font-size: 0.8rem; opacity: 0.65; }
.suggested { font-size: 0.8rem; opacity: 0.6; font-style: italic; }
.group-actions { display: flex; gap: var(--space); flex-wrap: wrap; align-items: center; }
.check { display: inline-flex; align-items: center; gap: calc(var(--space) * 0.5); font-size: 0.85rem; }
.transfer { display: flex; gap: var(--space); flex-wrap: wrap; align-items: center; }
.transfer select { flex: 1; min-width: 200px; }
.hint { font-size: 0.85rem; opacity: 0.65; font-style: italic; }
.info { color: #2ecc71; font-size: 0.9rem; }
.btn-secondary { background: #555; }
.drafts-title { margin: calc(var(--space) * 4) 0 calc(var(--space) * 3); }
</style>
