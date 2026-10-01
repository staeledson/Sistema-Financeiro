<template>
  <div class="goals-view">
    <div class="view-header">
      <h2>Metas / Cofrinhos</h2>
      <button type="button" class="btn-primary" @click="showForm = true">+ Nova Meta</button>
    </div>

    <EmptyState v-if="loading" title="Carregando…" />
    <EmptyState v-else-if="!goals.length" title="Nenhuma meta criada ainda." />

    <div v-else class="goals-list">
      <div v-for="g in goals" :key="g.id" class="goal-card">
        <div class="goal-header">
          <span class="goal-name">{{ g.name }}</span>
          <button type="button" class="btn-icon" @click="deleteGoal(g.id)">✕</button>
        </div>
        <div class="goal-progress-row">
          <span>{{ fmt(Number(g.savedCents)) }} de {{ fmt(Number(g.targetCents)) }}</span>
          <span>{{ pct(g) }}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: Math.min(pct(g), 100) + '%' }" />
        </div>
        <div v-if="g.deadline" class="goal-deadline">Prazo: {{ g.deadline.slice(0, 10) }}</div>
        <button type="button" class="btn-outline btn-small" @click="openContribute(g)">Contribuir</button>
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
          <button type="button" class="btn-secondary" @click="showForm = false">Cancelar</button>
          <button type="button" class="btn-primary" @click="createGoal">Criar</button>
        </div>
      </div>
    </div>

    <!-- Contribute form -->
    <div v-if="contributeGoal" class="modal-overlay" @click.self="contributeGoal = null">
      <div class="modal">
        <h3>Contribuir para "{{ contributeGoal.name }}"</h3>
        <label>Valor (R$) <input v-model.number="contribAmount" type="number" min="0" step="0.01" /></label>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" @click="contributeGoal = null">Cancelar</button>
          <button type="button" class="btn-primary" @click="submitContribution">Confirmar</button>
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

const goals = ref<any[]>([]);
const loading = ref(true);
const showForm = ref(false);
const form = ref({ name: "", targetCents: 0, deadline: "" });
const contributeGoal = ref<any | null>(null);
const contribAmount = ref(0);

async function load() {
  loading.value = true;
  try {
    goals.value = await http<any[]>("GET", "/goals");
  } finally {
    loading.value = false;
  }
}
async function createGoal() {
  await http("POST", "/goals", {
    name: form.value.name,
    targetCents: Math.round(form.value.targetCents * 100),
    deadline: form.value.deadline || null,
  });
  showForm.value = false;
  form.value = { name: "", targetCents: 0, deadline: "" };
  load();
}
async function deleteGoal(id: string) {
  await http("DELETE", `/goals/${id}`);
  load();
}
function openContribute(g: any) {
  contributeGoal.value = g;
  contribAmount.value = 0;
}
async function submitContribution() {
  if (!contributeGoal.value) return;
  await http("POST", `/goals/${contributeGoal.value.id}/contribute`, { amountCents: Math.round(contribAmount.value * 100) });
  contributeGoal.value = null;
  load();
}

const fmt = formatBRL;

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
.goals-list { display: flex; flex-direction: column; gap: 1rem; }
.goal-card { padding: 1rem 1.25rem; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); }
.goal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
.goal-name { font-weight: 600; }
.goal-progress-row { display: flex; justify-content: space-between; font-size: 0.875rem; color: var(--text-muted); font-variant-numeric: tabular-nums; margin-bottom: 0.4rem; }
.progress-bar { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; margin-bottom: 0.5rem; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s; }
.goal-deadline { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.modal-overlay { position: fixed; inset: 0; background: var(--scrim); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.5rem; width: 360px; max-width: calc(100vw - 2rem); display: flex; flex-direction: column; gap: 1rem; }
.modal h3 { font-size: 1.1rem; font-weight: 600; }
label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; }
.modal-actions { display: flex; gap: 0.75rem; justify-content: flex-end; }
</style>
