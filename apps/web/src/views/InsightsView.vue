<template>
  <div class="insights-view">
    <div class="view-header">
      <h2>Insights</h2>
      <button type="button" class="btn-primary" :disabled="computing" @click="triggerCompute">
        {{ computing ? "Calculando…" : "Atualizar" }}
      </button>
    </div>

    <EmptyState v-if="loading" title="Carregando…" />
    <EmptyState v-else-if="!insights.length" title="Nenhum insight ainda. Clique em Atualizar." />

    <div v-else class="insights-list">
      <div
        v-for="ins in insights"
        :key="ins.id"
        :class="['insight-card', ins.type, { unread: !ins.read }]"
        @click="markRead(ins)"
      >
        <div class="insight-icon">{{ insightIcon(ins.type) }}</div>
        <div class="insight-body">
          <p class="insight-title">{{ insightTitle(ins) }}</p>
          <p class="insight-detail">{{ insightDetail(ins) }}</p>
          <span class="insight-period">{{ ins.period || ins.createdAt.slice(0, 10) }}</span>
        </div>
        <div v-if="!ins.read" class="unread-dot" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { http } from "../lib/http";
import { insightDetail, insightIcon, insightTitle } from "../lib/insight-text";
import EmptyState from "../components/ui/EmptyState.vue";

const insights = ref<any[]>([]);
const loading = ref(true);
const computing = ref(false);

async function load() {
  loading.value = true;
  try {
    insights.value = await http<any[]>("GET", "/insights");
  } finally {
    loading.value = false;
  }
}
async function markRead(ins: any) {
  if (ins.read) return;
  await http("PATCH", `/insights/${ins.id}/read`);
  ins.read = true;
}
async function triggerCompute() {
  computing.value = true;
  try {
    await http("POST", "/insights/compute");
    setTimeout(load, 3000);
  } finally {
    computing.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.insights-view { padding: 1.5rem; max-width: 720px; margin: 0 auto; }
.view-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.view-header h2 { font-size: 1.4rem; font-weight: 600; }
.insights-list { display: flex; flex-direction: column; gap: 0.75rem; }
.insight-card {
  display: flex; align-items: flex-start; gap: 1rem;
  padding: 1rem 1.25rem; border-radius: var(--radius);
  background: var(--surface);
  border: 1px solid var(--border);
  cursor: pointer; transition: box-shadow 0.15s;
}
.insight-card:hover { box-shadow: var(--shadow); }
.insight-card.unread { border-left: 3px solid var(--accent); }
.insight-icon { font-size: 1.6rem; line-height: 1; flex-shrink: 0; }
.insight-body { flex: 1; }
.insight-title { font-weight: 600; margin-bottom: 0.25rem; }
.insight-detail { font-size: 0.875rem; color: var(--text-muted); }
.insight-period { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; display: block; }
.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex-shrink: 0; margin-top: 0.3rem; }
</style>
