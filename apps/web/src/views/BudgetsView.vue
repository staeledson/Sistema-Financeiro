<template>
  <div class="budgets-view">
    <div class="view-header">
      <h2>Orçamentos</h2>
      <button type="button" class="btn-primary" @click="showForm = true">+ Novo</button>
    </div>

    <p v-if="erro && !showForm" role="alert" class="text-error">{{ erro }}</p>
    <EmptyState v-if="loading" title="Carregando…" />
    <EmptyState v-else-if="!statuses.length" title="Nenhum orçamento configurado." />

    <div v-else class="budget-list">
      <div v-for="b in statuses" :key="`${b.id}:${b.method}`" class="budget-card">
        <div class="budget-info">
          <span class="budget-label">{{ labelFor(b) }}</span>
          <span class="budget-amounts">{{ fmt(b.spentCents) }} / {{ fmt(b.limitCents) }}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :class="{ danger: b.pct >= 100, warn: b.pct >= 80 }" :style="{ width: Math.min(b.pct, 100) + '%' }" />
        </div>
        <div class="budget-footer">
          <span :class="['pct', { danger: b.pct >= 100, warn: b.pct >= 80 }]">{{ b.pct }}%</span>
          <button type="button" class="btn-icon" @click="deleteBudget(b.id)">✕</button>
        </div>
      </div>
    </div>

    <!-- Add form modal -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="modal">
        <h3>Novo Orçamento</h3>
        <label>Método
          <select v-model="form.method">
            <option value="fixed">Fixo por categoria</option>
            <option value="needs">Necessidades (50%)</option>
            <option value="wants">Desejos (30%)</option>
            <option value="savings">Poupança (20%)</option>
          </select>
        </label>
        <label v-if="form.method === 'fixed'">Categoria
          <select v-model="form.categoryId">
            <option value="">— Categoria —</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label v-if="form.method === 'fixed'">Limite (R$)
          <input v-model.number="form.limitReais" type="number" min="0" step="0.01" placeholder="0.00" />
        </label>
        <p v-if="erro" role="alert" class="text-error">{{ erro }}</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="showForm = false">Cancelar</button>
          <button type="button" class="btn-primary" :disabled="!canSave" @click="save">Salvar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { http } from "../lib/http";
import { api, type Category } from "../lib/api";
import { formatBRL } from "../lib/money";
import { localToday } from "../lib/dashboard-client";
import EmptyState from "../components/ui/EmptyState.vue";

interface BudgetStatus { id: string; method: "fixed" | "needs" | "wants" | "savings"; categoryId: string | null; limitCents: number; spentCents: number; pct: number }

const statuses = ref<BudgetStatus[]>([]);
const categories = ref<Category[]>([]);
const loading = ref(true);
const showForm = ref(false);
const erro = ref("");
const form = ref({ method: "fixed" as BudgetStatus["method"], categoryId: "", limitReais: 0 });

const canSave = computed(() => form.value.method !== "fixed" || (form.value.categoryId !== "" && form.value.limitReais > 0));

async function load() {
  loading.value = true;
  erro.value = "";
  try {
    statuses.value = await http<BudgetStatus[]>("GET", `/budgets/status?asOf=${localToday()}`);
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  erro.value = "";
  try {
    await http("POST", "/budgets", form.value.method === "fixed"
      ? { method: "fixed", categoryId: form.value.categoryId, limitCents: Math.round(form.value.limitReais * 100) }
      : { method: form.value.method });
    showForm.value = false;
    form.value = { method: "fixed", categoryId: "", limitReais: 0 };
    await load();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

async function deleteBudget(id: string) {
  erro.value = "";
  try {
    await http("DELETE", `/budgets/${id}`);
    await load();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

const fmt = formatBRL;

const LABEL: Record<string, string> = { fixed: "Fixo", needs: "Necessidades 50%", wants: "Desejos 30%", savings: "Poupança 20%" };
function labelFor(b: BudgetStatus) {
  if (b.method === "fixed") return `Fixo · ${categories.value.find((c) => c.id === b.categoryId)?.name ?? "categoria removida"}`;
  return LABEL[b.method] ?? b.method;
}

onMounted(async () => {
  try {
    categories.value = await api.categories.list("expense");
  } catch {
    /* nomes das categorias são secundários */
  }
  await load();
});
</script>

<style scoped>
.budgets-view { padding: 1.5rem; max-width: 720px; margin: 0 auto; }
.view-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.view-header h2 { font-size: 1.4rem; font-weight: 600; }
.budget-list { display: flex; flex-direction: column; gap: 1rem; }
.budget-card { padding: 1rem 1.25rem; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); }
.budget-info { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
.budget-label { font-weight: 600; }
.budget-amounts { font-size: 0.875rem; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.progress-bar { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s; }
.progress-fill.warn { background: var(--warning); }
.progress-fill.danger { background: var(--danger); }
.budget-footer { display: flex; justify-content: space-between; align-items: center; }
.pct { font-size: 0.875rem; font-weight: 600; }
.pct.warn { color: var(--warning); }
.pct.danger { color: var(--danger); }
.modal-overlay { position: fixed; inset: 0; background: var(--scrim); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; width: 360px; max-width: calc(100vw - 2rem); display: flex; flex-direction: column; gap: 1rem; }
.modal h3 { font-size: 1.1rem; font-weight: 600; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; }
.modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
</style>
