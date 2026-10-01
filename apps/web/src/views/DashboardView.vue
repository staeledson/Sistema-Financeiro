<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useFinanceStore } from "../stores/finance";
import { sortBreakdown } from "../lib/dashboard-format";
import Money from "../components/ui/Money.vue";
import EmptyState from "../components/ui/EmptyState.vue";

const store = useFinanceStore();
const month = ref(new Date().toISOString().slice(0, 7)); // YYYY-MM

onMounted(async () => {
  await store.loadDashboard(month.value);
});

async function mudarMes() {
  await store.loadDashboard(month.value);
}

const cashflow = computed(() => store.dashboard?.cashflow);
const saldo = computed(() => (cashflow.value?.incomeCents ?? 0) - (cashflow.value?.expenseCents ?? 0));

const breakdown = computed(() => sortBreakdown(store.dashboard?.expenseBreakdown ?? []));

const series = computed(() => store.dashboard?.cashflowSeries ?? []);
</script>

<template>
  <section class="dashboard">
    <div class="header-row">
      <h2>Dashboard</h2>
      <input v-model="month" type="month" @change="mudarMes" />
    </div>

    <!-- Cashflow summary -->
    <div class="cashflow" v-if="cashflow">
      <div class="cf-card income">
        <span class="cf-label">Receitas</span>
        <span class="cf-value"><Money :cents="cashflow.incomeCents" /></span>
      </div>
      <div class="cf-card expense">
        <span class="cf-label">Despesas</span>
        <span class="cf-value"><Money :cents="cashflow.expenseCents" /></span>
      </div>
      <div class="cf-card" :class="saldo >= 0 ? 'income' : 'expense'">
        <span class="cf-label">Saldo do mês</span>
        <span class="cf-value"><Money :cents="saldo" /></span>
      </div>
    </div>
    <EmptyState v-else title="Carregando..." />

    <!-- Expense breakdown -->
    <div class="breakdown" v-if="breakdown.length > 0">
      <h3>Despesas por categoria</h3>
      <ul class="breakdown-list">
        <li v-for="item in breakdown" :key="item.name" class="breakdown-item">
          <span class="cat-name">{{ item.name }}</span>
          <div class="bar-wrap">
            <div class="bar" :style="{ width: `${item.pct}%` }"></div>
          </div>
          <span class="cat-amount"><Money :cents="item.amountCents" /></span>
        </li>
      </ul>
    </div>

    <!-- Cashflow series -->
    <div class="series" v-if="series.length > 0">
      <h3>Últimos meses</h3>
      <ul class="series-list">
        <li v-for="s in series" :key="s.month" class="series-item">
          <span class="series-month">{{ s.month }}</span>
          <span class="series-income">+<Money :cents="s.incomeCents" /></span>
          <span class="series-expense">−<Money :cents="s.expenseCents" /></span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.dashboard { padding: calc(var(--space) * 3); max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 4); }
.header-row { display: flex; justify-content: space-between; align-items: center; }
h2, h3 { margin: 0; }
.cashflow { display: flex; gap: calc(var(--space) * 2); flex-wrap: wrap; }
.cf-card { flex: 1; min-width: 160px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: calc(var(--space) * 3); display: flex; flex-direction: column; gap: var(--space); }
.cf-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.cf-value { font-size: 1.4rem; font-weight: 700; }
.cf-card.income .cf-value { color: var(--c-income); }
.cf-card.expense .cf-value { color: var(--c-expense); }
.breakdown-list, .series-list { list-style: none; display: flex; flex-direction: column; gap: var(--space); margin-top: calc(var(--space) * 2); }
.breakdown-item { display: grid; grid-template-columns: 160px 1fr auto; align-items: center; gap: calc(var(--space) * 2); }
.bar-wrap { background: var(--surface-2); border-radius: 99px; height: 8px; overflow: hidden; }
.bar { background: var(--accent); height: 100%; border-radius: 99px; transition: width .3s; min-width: 2px; }
.cat-amount { font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
.series-item { display: flex; gap: calc(var(--space) * 3); align-items: center; background: var(--surface); border: 1px solid var(--border); padding: calc(var(--space) * 1.5) calc(var(--space) * 2); border-radius: calc(var(--radius) / 1.5); }
.series-month { font-weight: 600; min-width: 70px; }
.series-income { color: var(--c-income); }
.series-expense { color: var(--c-expense); }
</style>
