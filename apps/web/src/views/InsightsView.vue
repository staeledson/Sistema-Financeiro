<template>
  <div class="insights-view">
    <div class="view-header">
      <h2>Insights</h2>
      <button class="btn-primary" :disabled="computing" @click="triggerCompute">
        {{ computing ? "Calculando…" : "Atualizar" }}
      </button>
    </div>

    <div v-if="loading" class="empty-state">Carregando…</div>
    <div v-else-if="!insights.length" class="empty-state">Nenhum insight ainda. Clique em Atualizar.</div>

    <div v-else class="insights-list">
      <div
        v-for="ins in insights"
        :key="ins.id"
        :class="['insight-card', ins.type, { unread: !ins.read }]"
        @click="markRead(ins)"
      >
        <div class="insight-icon">{{ iconFor(ins.type) }}</div>
        <div class="insight-body">
          <p class="insight-title">{{ titleFor(ins) }}</p>
          <p class="insight-detail">{{ detailFor(ins) }}</p>
          <span class="insight-period">{{ ins.period || ins.createdAt.slice(0, 10) }}</span>
        </div>
        <div v-if="!ins.read" class="unread-dot" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const insights = ref<any[]>([]);
const loading = ref(true);
const computing = ref(false);

async function load() {
  loading.value = true;
  try {
    const r = await fetch("/api/insights", { headers: auth.headers });
    insights.value = await r.json();
  } finally {
    loading.value = false;
  }
}

async function markRead(ins: any) {
  if (ins.read) return;
  await fetch(`/api/insights/${ins.id}/read`, { method: "PATCH", headers: auth.headers });
  ins.read = true;
}

async function triggerCompute() {
  computing.value = true;
  try {
    await fetch("/api/insights/compute", { method: "POST", headers: auth.headers });
    setTimeout(load, 3000);
  } finally {
    computing.value = false;
  }
}

function iconFor(type: string) {
  const map: Record<string, string> = {
    spike: "📈",
    subscription: "🔄",
    budget_alert: "⚠️",
    cashflow_forecast: "🔮",
  };
  return map[type] ?? "💡";
}

function titleFor(ins: any) {
  const p = ins.payload;
  switch (ins.type) {
    case "spike":
      return `Gasto acima do normal em ${p.categoryName}`;
    case "subscription":
      return `Assinatura detectada: ${p.counterparty}`;
    case "budget_alert":
      return `Orçamento ${p.pct}% utilizado`;
    case "cashflow_forecast":
      return p.forecastBalanceCents >= 0 ? "Previsão positiva este mês" : "Atenção: déficit previsto";
    default:
      return ins.type;
  }
}

function detailFor(ins: any) {
  const p = ins.payload;
  const fmt = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
  switch (ins.type) {
    case "spike":
      return `${p.pctAboveAvg}% acima da média (atual ${fmt(p.currentCents)} vs média ${fmt(p.avgCents)})`;
    case "subscription":
      return `Detectada por ${p.monthsDetected} meses · média ${fmt(p.avgCents)}/mês`;
    case "budget_alert":
      return `${fmt(p.spentCents)} gastos de ${fmt(p.limitCents)} planejados`;
    case "cashflow_forecast":
      return p.narrative ?? `Previsão: ${fmt(Math.abs(p.forecastBalanceCents))}`;
    default:
      return "";
  }
}

onMounted(load);
</script>

<style scoped>
.insights-view { padding: 1.5rem; max-width: 720px; margin: 0 auto; }
.view-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
.view-header h2 { font-size: 1.4rem; font-weight: 600; }
.empty-state { text-align: center; padding: 3rem; color: var(--color-text-muted, #888); }
.insights-list { display: flex; flex-direction: column; gap: 0.75rem; }
.insight-card {
  display: flex; align-items: flex-start; gap: 1rem;
  padding: 1rem 1.25rem; border-radius: 0.75rem;
  background: var(--color-surface, #fff);
  border: 1px solid var(--color-border, #e5e7eb);
  cursor: pointer; transition: box-shadow 0.15s;
}
.insight-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.insight-card.unread { border-left: 3px solid var(--color-primary, #6366f1); }
.insight-icon { font-size: 1.6rem; line-height: 1; flex-shrink: 0; }
.insight-body { flex: 1; }
.insight-title { font-weight: 600; margin-bottom: 0.25rem; }
.insight-detail { font-size: 0.875rem; color: var(--color-text-muted, #6b7280); }
.insight-period { font-size: 0.75rem; color: var(--color-text-muted, #9ca3af); margin-top: 0.25rem; display: block; }
.unread-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary, #6366f1); flex-shrink: 0; margin-top: 0.3rem; }
.btn-primary { padding: 0.5rem 1.25rem; background: var(--color-primary, #6366f1); color: #fff; border: none; border-radius: 0.5rem; cursor: pointer; font-size: 0.9rem; }
.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
