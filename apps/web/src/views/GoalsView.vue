<template>
  <div class="goals-view">
    <div class="view-header">
      <h2>Metas / Cofrinhos</h2>
      <button class="btn-primary" @click="showForm = true">+ Nova Meta</button>
    </div>

    <div v-if="loading" class="empty-state">Carregando…</div>
    <div v-else-if="!goals.length" class="empty-state">Nenhuma meta criada ainda.</div>

    <div v-else class="goals-list">
      <div v-for="g in goals" :key="g.id" class="goal-card">
        <div class="goal-header">
          <span class="goal-name">{{ g.name }}</span>
          <button class="btn-icon" @click="deleteGoal(g.id)">✕</button>
        </div>
        <div class="goal-progress-row">
          <span>{{ fmt(Number(g.savedCents)) }} de {{ fmt(Number(g.targetCents)) }}</span>
          <span>{{ pct(g) }}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: Math.min(pct(g), 100) + '%' }" />
        </div>
        <div v-if="g.deadline" class="goal-deadline">Prazo: {{ g.deadline.slice(0, 10) }}</div>
        <button class="btn-contribute" @click="openContribute(g)">Contribuir</button>
      </div>
    </div>

    <!-- New goal form -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="modal">
        <h3>Nova Meta</h3>
        <label>Nome <input v-model="form.name" type="text" placeholder="Ex: Viagem de férias" /></label>
        <label>Valor alvo (R$) <input v-model.number="form.targetCents" type="number" min="0" step="0.01" /></label>
        <label>Prazo (opcional) <input v-model="form.deadline" type="date" /></label>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showForm = false">Cancelar</button>
          <button class="btn-primary" @click="createGoal">Criar</button>
        </div>
      </div>
    </div>

    <!-- Contribute form -->
    <div v-if="contributeGoal" class="modal-overlay" @click.self="contributeGoal = null">
      <div class="modal">
        <h3>Contribuir para "{{ contributeGoal.name }}"</h3>
        <label>Valor (R$) <input v-model.number="contribAmount" type="number" min="0" step="0.01" /></label>
        <div class="modal-actions">
          <button class="btn-secondary" @click="contributeGoal = null">Cancelar</button>
          <button class="btn-primary" @click="submitContribution">Confirmar</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const goals = ref<any[]>([]);
const loading = ref(true);
const showForm = ref(false);
const form = ref({ name: "", targetCents: 0, deadline: "" });
const contributeGoal = ref<any | null>(null);
const contribAmount = ref(0);

async function load() {
  loading.value = true;
  try {
    const r = await fetch("/api/goals", { headers: auth.headers });
    goals.value = await r.json();
  } finally {
    loading.value = false;
  }
}

async function createGoal() {
  await fetch("/api/goals", {
    method: "POST",
    headers: { ...auth.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: form.value.name,
      targetCents: Math.round(form.value.targetCents * 100),
      deadline: form.value.deadline || null,
    }),
  });
  showForm.value = false;
  form.value = { name: "", targetCents: 0, deadline: "" };
  load();
}

async function deleteGoal(id: string) {
  await fetch(`/api/goals/${id}`, { method: "DELETE", headers: auth.headers });
  load();
}

function openContribute(g: any) {
  contributeGoal.value = g;
  contribAmount.value = 0;
}

async function submitContribution() {
  if (!contributeGoal.value) return;
  await fetch(`/api/goals/${contributeGoal.value.id}/contribute`, {
    method: "POST",
    headers: { ...auth.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ amountCents: Math.round(contribAmount.value * 100) }),
  });
  contributeGoal.value = null;
  load();
}

function fmt(c: number) {
  return `R$ ${(c / 100).toFixed(2)}`;
}

function pct(g: any) {
  const t = Number(g.targetCents);
  if (!t) return 0;
  return Math.min(100, Math.round((Number(g.savedCents) / t) * 100));
}

onMounted(load);
</script>

<style scoped>
.goals-view { padding: 1.5rem; max-width: 720px; margin: 0 auto; }
.view-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.view-header h2 { font-size: 1.4rem; font-weight: 600; }
.empty-state { text-align: center; padding: 3rem; color: var(--color-text-muted, #888); }
.goals-list { display: flex; flex-direction: column; gap: 1rem; }
.goal-card { padding: 1rem 1.25rem; border-radius: 0.75rem; background: var(--color-surface, #fff); border: 1px solid var(--color-border, #e5e7eb); }
.goal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.goal-name { font-weight: 600; }
.goal-progress-row { display: flex; justify-content: space-between; font-size: 0.875rem; color: var(--color-text-muted, #6b7280); margin-bottom: 0.4rem; }
.progress-bar { height: 8px; background: var(--color-border, #e5e7eb); border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem; }
.progress-fill { height: 100%; background: var(--color-primary, #6366f1); border-radius: 4px; transition: width 0.3s; }
.goal-deadline { font-size: 0.75rem; color: var(--color-text-muted, #9ca3af); margin-bottom: 0.5rem; }
.btn-contribute { padding: 0.35rem 0.9rem; background: transparent; border: 1px solid var(--color-primary, #6366f1); color: var(--color-primary, #6366f1); border-radius: 0.5rem; cursor: pointer; font-size: 0.85rem; }
.btn-icon { background: none; border: none; cursor: pointer; color: var(--color-text-muted, #9ca3af); }
.btn-primary { padding: 0.5rem 1.25rem; background: var(--color-primary, #6366f1); color: #fff; border: none; border-radius: 0.5rem; cursor: pointer; }
.btn-secondary { padding: 0.5rem 1.25rem; background: var(--color-surface, #f3f4f6); border: 1px solid var(--color-border, #e5e7eb); border-radius: 0.5rem; cursor: pointer; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--color-surface, #fff); border-radius: 0.75rem; padding: 1.5rem; width: 360px; display: flex; flex-direction: column; gap: 1rem; }
.modal h3 { font-size: 1.1rem; font-weight: 600; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; }
input { padding: 0.5rem; border: 1px solid var(--color-border, #e5e7eb); border-radius: 0.5rem; }
.modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
</style>
