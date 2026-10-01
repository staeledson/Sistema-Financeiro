<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { api } from "../lib/api";
import { categoryLink, expensesMonthLink, localToday, type PainelFilter } from "../lib/dashboard-client";
import { budgetBars, PALETTE_SIZE, pieSlices, spendingPie, spendingStack } from "../lib/dashboard-charts";
import { formatDate } from "../lib/import-client";
import { formatBRL } from "../lib/money";
import { useSection } from "../lib/use-section";
import { useWorkspaceStore } from "../stores/workspace";
import type { ThemeColors } from "../lib/theme-colors";
import Card from "../components/ui/Card.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import EntityBadge from "../components/ui/EntityBadge.vue";
import Money from "../components/ui/Money.vue";
import EChart, { type EChartClick } from "../components/charts/EChart.vue";

const route = useRoute();
const router = useRouter();
const workspace = useWorkspaceStore();

// O resumo é sempre do workspace inteiro; só o "hoje" do navegador entra na consulta.
const summary = useSection(() => api.summary(localToday()));
const onInicio = () => route.path === "/";

onMounted(() => void summary.run());
// Troca de workspace: os números são de outro workspace.
watch(() => workspace.activeId, () => onInicio() && void summary.run());

// Filtro usado só para montar os links da lista de transações (mês corrente, tudo).
const monthFilter = computed<PainelFilter>(() => ({ entity: "all", accountId: "", month: localToday().slice(0, 7) }));

const monthExpensesLink = computed(() => expensesMonthLink(monthFilter.value, monthFilter.value.month!));

const data = computed(() => summary.data.value);
const spending = computed(() => data.value?.spending ?? null);
const pieItems = computed(() => pieSlices(spending.value?.byCategory ?? [], PALETTE_SIZE));
const pieOption = computed(() => (c: ThemeColors) => spendingPie(spending.value?.byCategory ?? [], c));
const stackOption = computed(() => (c: ThemeColors) => spendingStack(spending.value?.byMonth ?? { months: [], series: [] }, c));
const budgetOption = computed(() => (c: ThemeColors) => budgetBars(spending.value?.vsBudget ?? [], c));

const spendingInsight = computed(() => {
  const s = spending.value;
  if (!s) return undefined;
  return s.insight ?? (s.totalCents > 0 ? "Sem variação relevante em relação ao mês anterior." : undefined);
});

function onPieClick(e: EChartClick) {
  const item = pieItems.value[e.dataIndex];
  if (!item || item.categoryId === null) return; // "Outras" reúne várias categorias
  void router.push(categoryLink(monthFilter.value, item.categoryId));
}

function onStackClick(e: EChartClick) {
  const by = spending.value?.byMonth;
  const series = by?.series[e.seriesIndex];
  const month = by?.months[e.dataIndex];
  if (!series || !month) return;
  if (series.key === "__others") void router.push(expensesMonthLink(monthFilter.value, month));
  else void router.push(categoryLink(monthFilter.value, series.categoryId ?? "__none", month));
}

function onBudgetClick(e: EChartClick) {
  const item = spending.value?.vsBudget[e.dataIndex];
  if (item) void router.push(categoryLink(monthFilter.value, item.categoryId));
}

const pendingText = computed(() => {
  const n = data.value?.pendingCount ?? 0;
  if (n === 0) return "Nada para categorizar.";
  return n === 1 ? "1 lançamento aguardando." : `${n} lançamentos aguardando.`;
});
</script>

<template>
  <section class="inicio">
    <header class="inicio-head">
      <div>
        <h2>Início</h2>
        <p class="lead">Resumo de todas as suas contas, PF e PJ.</p>
      </div>
      <RouterLink to="/painel" class="btn-link">Abrir o painel</RouterLink>
    </header>

    <div v-if="summary.error.value" class="state" role="alert">
      <p>{{ summary.error.value }}</p>
      <button type="button" @click="summary.run()">Tentar de novo</button>
    </div>
    <p v-else-if="!data" class="state" role="status">Carregando…</p>

    <div v-else class="content" :class="{ stale: summary.loading.value }" :aria-busy="summary.loading.value">
      <section class="grid balances" aria-label="Saldos">
        <Card title="Pessoa Física">
          <template #actions><EntityBadge entity="pf" /></template>
          <p class="big"><Money :cents="data.balances.pfCents" colored /></p>
        </Card>
        <Card title="Pessoa Jurídica">
          <template #actions><EntityBadge entity="pj" /></template>
          <p class="big"><Money :cents="data.balances.pjCents" colored /></p>
        </Card>
        <Card title="Saldo total em contas">
          <p class="big"><Money :cents="data.balances.totalCents" colored /></p>
        </Card>
      </section>

      <!-- Dívida dos cartões: fica fora do saldo em contas (é gasto futuro, não caixa). -->
      <section v-if="data.balances.cards.totalCents !== 0" class="cards-owed" aria-label="Cartões a pagar">
        <Card title="Cartões a pagar">
          <p class="big"><Money :cents="data.balances.cards.totalCents" colored /></p>
          <p class="note">PF {{ formatBRL(data.balances.cards.pfCents) }} · PJ {{ formatBRL(data.balances.cards.pjCents) }}</p>
        </Card>
      </section>

      <section class="grid two" aria-label="Pendências">
        <Card title="Para categorizar" to="/categorizar">
          <p class="big">{{ data.pendingCount }}</p>
          <p class="note">{{ pendingText }}</p>
        </Card>
        <Card title="Próxima fatura" :to="{ path: '/painel', hash: '#sec-cartoes' }">
          <template v-if="data.nextInvoice">
            <p class="big"><Money :cents="data.nextInvoice.openInvoiceCents" /></p>
            <p class="note">{{ data.nextInvoice.name }} · vence em {{ formatDate(data.nextInvoice.dueDate) }}</p>
          </template>
          <p v-else class="note">Nenhuma fatura a vencer. Cartões precisam de dias de fechamento e vencimento em Contas.</p>
        </Card>
      </section>

      <section class="spending" aria-labelledby="sec-inicio-gastos">
        <h3 id="sec-inicio-gastos" class="block-title">Para onde foi o dinheiro este mês</h3>
        <Card title="Despesas do mês" :value="formatBRL(data.spending.totalCents)" :insight="spendingInsight" :to="monthExpensesLink" />
        <div v-if="data.spending.totalCents > 0" class="grid two">
          <Card title="Por categoria">
            <EChart :option="pieOption" label="Despesas do mês por categoria" :height="280" @click="onPieClick" />
          </Card>
          <Card title="Evolução mensal por categoria">
            <EChart :option="stackOption" label="Despesas dos últimos 12 meses, empilhadas por categoria" :height="280" @click="onStackClick" />
          </Card>
          <Card class="span-2" title="Orçamento">
            <EChart
              v-if="data.spending.vsBudget.length"
              :option="budgetOption"
              label="Uso do orçamento por categoria"
              :height="Math.max(160, data.spending.vsBudget.length * 38 + 24)"
              @click="onBudgetClick"
            />
            <EmptyState v-else title="Nenhum orçamento fixo" hint="Defina limites em Orçamentos para acompanhar aqui." />
          </Card>
        </div>
        <EmptyState v-else title="Sem despesas este mês" hint="Importe um extrato ou lance despesas para ver a distribuição." />
      </section>

    </div>
  </section>
</template>

<style scoped>
.inicio { padding: calc(var(--space) * 3); max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
.inicio-head { display: flex; align-items: flex-start; justify-content: space-between; gap: calc(var(--space) * 2); flex-wrap: wrap; }
.lead { color: var(--text-muted); font-size: 0.9rem; margin-top: calc(var(--space) * 0.5); }
.content { display: flex; flex-direction: column; gap: calc(var(--space) * 3); min-width: 0; }
.grid { display: grid; gap: calc(var(--space) * 2); }
.grid > * { min-width: 0; }
.grid.balances { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid .span-2 { grid-column: 1 / -1; }
.spending { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
.block-title { font-size: 1.1rem; }
.big { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-size: 1.6rem; font-weight: 700; }
.note { margin-top: calc(var(--space) * 0.5); font-size: 0.85rem; color: var(--text-muted); }
.stale { opacity: 0.6; transition: opacity 0.15s; }
.state { padding: calc(var(--space) * 3); color: var(--text-muted); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.state button { margin-top: var(--space); }
.btn-link { display: inline-block; padding: calc(var(--space) * 1) calc(var(--space) * 2); border-radius: var(--radius); background: var(--accent); color: var(--accent-text); font-weight: 600; text-decoration: none; }
.btn-link:hover { opacity: 0.9; }

@media (max-width: 768px) {
  .inicio { padding: calc(var(--space) * 2); }
  .grid.balances, .grid.two { grid-template-columns: 1fr; }
  .grid .span-2 { grid-column: auto; }
}
</style>
