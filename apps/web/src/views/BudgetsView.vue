<template>
  <div class="budgets-view">
    <div class="view-header">
      <h2>Orçamentos</h2>
      <button class="btn-primary" @click="showForm = true">+ Novo</button>
    </div>

    <div v-if="loading" class="empty-state">Carregando…</div>
    <div v-else-if="!statuses.length" class="empty-state">Nenhum orçamento configurado.</div>

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
          <button class="btn-icon" @click="deleteBudget(b.id)">✕</button>
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
          <button class="btn-secondary" @click="showForm = false">Cancelar</button>
          <button class="btn-primary" @click="save">Salvar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const statuses = ref<any[]>([]);
const loading = ref(true);
const showForm = ref(false);
const form = ref({ method: "fixed", limitCents: 0 });

async function load() {
  loading.value = true;
  try {
    const r = await fetch("/api/budgets/status", { headers: auth.headers });
    statuses.value = await r.json();
  } finally {
    loading.value = false;
  }
}

async function save() {
  await fetch("/api/budgets", {
    method: "POST",
    headers: { ...auth.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      method: form.value.method,
      limitCents: form.value.method === "fixed" ? Math.round(form.value.limitCents * 100) : null,
    }),
  });
  showForm.value = false;
  load();
}

async function deleteBudget(id: string) {
  await fetch(`/api/budgets/${id}`, { method: "DELETE", headers: auth.headers });
  load();
}

function fmt(c: number) {
  return `R$ ${(c / 100).toFixed(2)}`;
}

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
.empty-state { text-align: center; padding: 3rem; color: var(--color-text-muted, #888); }
.budget-list { display: flex; flex-direction: column; gap: 1rem; }
.budget-card { padding: 1rem 1.25rem; border-radius: 0.75rem; background: var(--color-surface, #fff); border: 1px solid var(--color-border, #e5e7eb); }
.budget-info { display: flex; justify-content: space-between; margin-bottom: 0.5rem; }
.budget-label { font-weight: 600; }
.budget-amounts { font-size: 0.875rem; color: var(--color-text-muted, #6b7280); }
.progress-bar { height: 8px; background: var(--color-border, #e5e7eb); border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem; }
.progress-fill { height: 100%; background: var(--color-primary, #6366f1); border-radius: 4px; transition: width 0.3s; }
.progress-fill.warn { background: #f59e0b; }
.progress-fill.danger { background: #ef4444; }
.budget-footer { display: flex; justify-content: space-between; align-items: center; }
.pct { font-size: 0.875rem; font-weight: 600; }
.pct.warn { color: #f59e0b; }
.pct.danger { color: #ef4444; }
.btn-icon { background: none; border: none; cursor: pointer; color: var(--color-text-muted, #9ca3af); font-size: 0.85rem; }
.btn-primary { padding: 0.5rem 1.25rem; background: var(--color-primary, #6366f1); color: #fff; border: none; border-radius: 0.5rem; cursor: pointer; }
.btn-secondary { padding: 0.5rem 1.25rem; background: var(--color-surface, #f3f4f6); border: 1px solid var(--color-border, #e5e7eb); border-radius: 0.5rem; cursor: pointer; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--color-surface, #fff); border-radius: 0.75rem; padding: 1.5rem; width: 360px; display: flex; flex-direction: column; gap: 1rem; }
.modal h3 { font-size: 1.1rem; font-weight: 600; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; }
select, input { padding: 0.5rem; border: 1px solid var(--color-border, #e5e7eb); border-radius: 0.5rem; }
.modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
</style>
