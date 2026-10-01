<template>
  <div class="budgets-view">
    <div class="view-header">
      <h2>Orçamentos</h2>
      <button type="button" class="btn-primary" @click="showForm = true">+ Novo</button>
    </div>

    <EmptyState v-if="loading" title="Carregando…" />
    <EmptyState v-else-if="!statuses.length" title="Nenhum orçamento configurado." />

    <div v-else class="budget-list">
      <div v-for="b in statuses" :key="b.id" class="budget-card">
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
        <label v-if="form.method === 'fixed'">Limite (R$)
          <input v-model.number="form.limitCents" type="number" min="0" step="0.01" placeholder="0.00" />
        </label>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="showForm = false">Cancelar</button>
          <button type="button" class="btn-primary" @click="save">Salvar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { http } from "../lib/http";
import { formatBRL } from "../lib/money";
import EmptyState from "../components/ui/EmptyState.vue";

const statuses = ref<any[]>([]);
const loading = ref(true);
const showForm = ref(false);
const form = ref({ method: "fixed", limitCents: 0 });

async function load() {
  loading.value = true;
  try {
    statuses.value = await http<any[]>("GET", "/budgets/status");
  } finally {
    loading.value = false;
  }
}
async function save() {
  await http("POST", "/budgets", {
    method: form.value.method,
    limitCents: form.value.method === "fixed" ? Math.round(form.value.limitCents * 100) : null,
  });
  showForm.value = false;
  load();
}
async function deleteBudget(id: string) {
  await http("DELETE", `/budgets/${id}`);
  load();
}

const fmt = formatBRL;

function labelFor(b: any) {
  const map: Record<string, string> = { fixed: "Fixo", needs: "Necessidades 50%", wants: "Desejos 30%", savings: "Poupança 20%" };
  return map[b.method] ?? b.method;
}

onMounted(load);
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
.modal-overlay { position: fixed; inset: 0; background: color-mix(in srgb, var(--text) 45%, transparent); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; width: 360px; max-width: calc(100vw - 2rem); display: flex; flex-direction: column; gap: 1rem; }
.modal h3 { font-size: 1.1rem; font-weight: 600; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; }
.modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
</style>
