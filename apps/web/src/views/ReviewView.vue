<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth";
import { useFinanceStore } from "../stores/finance";

const auth = useAuthStore();
const finance = useFinanceStore();
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

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
const erro = ref("");

// per-draft overrides
const overrides = ref<Record<string, { accountId: string; categoryId: string }>>({});

async function apiReq(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${auth.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function load() {
  drafts.value = await apiReq("GET", "/drafts");
  drafts.value.forEach((d) => {
    if (!overrides.value[d.id]) overrides.value[d.id] = { accountId: "", categoryId: d.categoryId ?? "" };
  });
}

onMounted(async () => {
  await Promise.all([finance.loadAccounts(), finance.loadCategories(), load()]);
});

async function confirm(draft: Draft) {
  erro.value = "";
  try {
    const ov = overrides.value[draft.id];
    await apiReq("POST", `/drafts/${draft.id}/confirm`, {
      accountId: ov.accountId || null,
      categoryId: ov.categoryId || null,
    });
    await load();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

async function discard(id: string) {
  await apiReq("DELETE", `/drafts/${id}`);
  await load();
}

function formatBRL(cents: number | null) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

const confidenceColor = (c: number | null) =>
  !c ? "#555" : c >= 0.85 ? "#2ecc71" : c >= 0.65 ? "#f39c12" : "#e74c3c";
</script>

<template>
  <section class="review">
    <h2>Revisar rascunhos</h2>

    <p v-if="drafts.length === 0" class="empty">Nenhum rascunho pendente.</p>
    <p v-if="erro" role="alert" class="error">{{ erro }}</p>

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
          <select v-if="overrides[d.id]" v-model="overrides[d.id].accountId">
            <option value="">— Conta —</option>
            <option v-for="a in finance.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <select v-if="overrides[d.id]" v-model="overrides[d.id].categoryId">
            <option value="">— Categoria —</option>
            <option
              v-for="c in finance.categories.filter(cat => !d.type || cat.type === d.type)"
              :key="c.id"
              :value="c.id"
            >{{ c.name }}</option>
          </select>
          <button @click="confirm(d)" :disabled="!overrides[d.id]?.accountId && d.type !== 'transfer'">Confirmar</button>
          <button class="btn-discard" @click="discard(d.id)">Descartar</button>
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
</style>
