<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useFinanceStore } from "../stores/finance";
import { useWorkspaceStore } from "../stores/workspace";
import { api, type CardDashboard, type InvoiceStatus } from "../lib/api";
import {
  cardCycleLink, categoryLink, expensesMonthLink, filterFromQuery, filterToParams, filterToQuery, monthLink, scopeToParams,
  transactionsLink, type PainelEntity, type PainelFilter,
} from "../lib/dashboard-client";
import {
  averageMonthlyCents, budgetBars, cardDailyLine, cashflowBars, forecastLine, installmentsBars, PALETTE_SIZE, pieSlices,
  spendingPie, spendingStack,
} from "../lib/dashboard-charts";
import { accountsForEntity, ENTITY_SHORT } from "../lib/entity";
import { formatBRL } from "../lib/money";
import { useSection } from "../lib/use-section";
import type { ThemeColors } from "../lib/theme-colors";
import type { EChartsOption } from "echarts";
import Card from "../components/ui/Card.vue";
import DataTable from "../components/ui/DataTable.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import EntityBadge from "../components/ui/EntityBadge.vue";
import FilterBar from "../components/ui/FilterBar.vue";
import PeriodPicker, { type PeriodValue } from "../components/ui/PeriodPicker.vue";
import EChart, { type EChartClick } from "../components/charts/EChart.vue";

const route = useRoute();
const router = useRouter();
const store = useFinanceStore();
const workspace = useWorkspaceStore();

// --- filtro global (vive na URL) -------------------------------------------------------------------------------

const filter = computed(() => filterFromQuery(route.query));
const period = computed<PeriodValue>(() => {
  const f = filter.value;
  if (f.from && f.to) return { from: f.from, to: f.to };
  if (f.year) return { year: f.year };
  if (f.quarter) return { quarter: f.quarter };
  return { month: f.month };
});
const accountOptions = computed(() => accountsForEntity(store.accounts.filter((a) => !a.archived), filter.value.entity));

function applyFilter(next: PainelFilter) {
  void router.replace({ query: filterToQuery(next) });
}

function onPeriod(p: PeriodValue) {
  const { entity, accountId } = filter.value;
  applyFilter({ entity, accountId, ...p });
}

function onEntity(entity: PainelEntity) {
  const current = filter.value;
  const keep = store.accounts.some((a) => a.id === current.accountId && (entity === "all" || a.entity === entity));
  applyFilter({ ...current, entity, accountId: keep ? current.accountId : "" });
}

function onAccount(accountId: string) {
  applyFilter({ ...filter.value, accountId });
}

// --- seções (cada uma com seu loading/erro e descarte de respostas antigas) --------------------------------------

const spending = useSection(() => api.dashboard.spending(filterToParams(filter.value)));
// `cards` e `cashflow` ignoram o período: só recarregam quando entidade ou conta mudam.
const cards = useSection(() => api.dashboard.cards(scopeToParams(filter.value)));
const cashflow = useSection(() => api.dashboard.cashflow(scopeToParams(filter.value)));

const spendingKey = computed(() => filterToParams(filter.value).toString());
const scopeKey = computed(() => scopeToParams(filter.value).toString());
const onPainel = () => route.path === "/painel";

watch(spendingKey, () => onPainel() && void spending.run());
watch(scopeKey, () => {
  if (!onPainel()) return;
  void cards.run();
  void cashflow.run();
});

function runAll() {
  void spending.run();
  void cards.run();
  void cashflow.run();
}

/** A conta da URL precisa existir (não arquivada) e pertencer à entidade escolhida; senão sai da query. */
function accountValid(f: PainelFilter): boolean {
  return store.accounts.some((a) => a.id === f.accountId && !a.archived && (f.entity === "all" || a.entity === f.entity));
}

async function loadAccountsSafe() {
  try {
    await store.loadAccounts();
  } catch {
    /* sem a lista, o seletor fica só com "Todas as contas" */
  }
}

onMounted(async () => {
  if (filter.value.accountId) {
    // espera as contas para não consultar a API com uma conta que não existe (400)
    await loadAccountsSafe();
    if (!onPainel()) return;
    if (!accountValid(filter.value)) {
      await router.replace({ query: filterToQuery({ ...filter.value, accountId: "" }) });
    }
  } else {
    void loadAccountsSafe();
  }
  runAll();
});

// Troca de workspace: a conta escolhida pertence ao workspace anterior.
watch(
  () => workspace.activeId,
  async () => {
    if (!onPainel()) return;
    if (filter.value.accountId) {
      // a mudança da query dispara os watchers de filtro (spending, cards e cashflow)
      await router.replace({ query: filterToQuery({ ...filter.value, accountId: "" }) });
    } else {
      runAll();
    }
    await loadAccountsSafe();
  },
);

// --- bloco 1: para onde vai o dinheiro --------------------------------------------------------------------------

const periodLink = computed(() => transactionsLink(filter.value));

const pieOption = computed(() => (c: ThemeColors) => spendingPie(spending.data.value?.byCategory ?? [], c));
// Mesmas fatias do gráfico (primeiras categorias + "Outras"), para mapear o clique no índice.
const pieItems = computed(() => pieSlices(spending.data.value?.byCategory ?? [], PALETTE_SIZE));
const stackOption = computed(() => (c: ThemeColors) =>
  spendingStack(spending.data.value?.byMonth ?? { months: [], series: [] }, c));
const budgetOption = computed(() => (c: ThemeColors) => budgetBars(spending.data.value?.vsBudget ?? [], c));

function onPieClick(e: EChartClick) {
  const item = pieItems.value[e.dataIndex];
  if (!item || item.categoryId === null) return; // "Outras" reúne várias categorias: sem destino único
  void router.push(categoryLink(filter.value, item.categoryId));
}

function onStackClick(e: EChartClick) {
  const by = spending.data.value?.byMonth;
  const series = by?.series[e.seriesIndex];
  const month = by?.months[e.dataIndex];
  if (!series || !month) return;
  if (series.key === "__others") void router.push(expensesMonthLink(filter.value, month));
  else void router.push(categoryLink(filter.value, series.categoryId ?? "__none", month));
}

function onBudgetClick(e: EChartClick) {
  const item = spending.data.value?.vsBudget[e.dataIndex];
  if (item) void router.push(categoryLink(filter.value, item.categoryId));
}

const monthlyAverage = computed(() => {
  const by = spending.data.value?.byMonth;
  return by ? averageMonthlyCents(by) : 0;
});

const spendingInsight = computed(() => {
  const s = spending.data.value;
  if (!s) return undefined;
  return s.insight ?? (s.totalCents > 0 ? "Sem variação relevante em relação ao período anterior." : undefined);
});

const budgetSummary = computed(() => {
  const list = spending.data.value?.vsBudget ?? [];
  const over = list.filter((b) => b.spentCents > b.limitCents).length;
  return {
    value: `${over} de ${list.length} acima do limite`,
    insight: list.length ? `${list[0].name} está em ${list[0].pct}% do limite.` : undefined,
  };
});

const recurringTotal = computed(() =>
  (spending.data.value?.recurring ?? []).reduce((s, g) => s + g.monthlyEstimateCents, 0));

const destinationColumns = [
  { key: "name", label: "Destino" },
  { key: "count", label: "Lançamentos", align: "right" as const },
  { key: "totalCents", label: "Total", align: "right" as const },
];
const recurringColumns = [
  { key: "label", label: "Despesa" },
  { key: "frequency", label: "Frequência" },
  { key: "avgCents", label: "Valor médio", align: "right" as const },
  { key: "monthlyEstimateCents", label: "Por mês", align: "right" as const },
];

// --- bloco 2: cartões e faturas ---------------------------------------------------------------------------------

const STATUS_LABEL: Record<InvoiceStatus, string> = { paid: "Paga", partial: "Parcial", open: "Aberta", overdue: "Vencida" };
const paymentColumns = [
  { key: "closing", label: "Fechamento" },
  { key: "due", label: "Vencimento" },
  { key: "invoiceCents", label: "Fatura", align: "right" as const },
  { key: "paidCents", label: "Pago", align: "right" as const },
  { key: "status", label: "Situação" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function cardInsight(c: CardDashboard): string {
  return `Fecha em ${fmtDate(c.closingDate)} · vence em ${fmtDate(c.dueDate)}`;
}

function limitPct(c: CardDashboard): number {
  return Math.max(0, Math.min(100, c.limitUsedPct ?? 0));
}

// Opções por cartão memorizadas: só mudam quando os dados de `cards` mudam (recarregar outras seções não reanima).
const cardOptions = computed(() => {
  const map = new Map<string, { cycle: (c: ThemeColors) => EChartsOption; installments: (c: ThemeColors) => EChartsOption }>();
  for (const c of cards.data.value?.cards ?? []) {
    map.set(c.accountId, {
      cycle: (colors) => cardDailyLine(c.cycleDaily, colors),
      installments: (colors) => installmentsBars(c.installmentsAhead, colors),
    });
  }
  return map;
});
const hasInstallments = (c: CardDashboard) => c.installmentsAhead.some((m) => m.amountCents > 0);

function cardLink(c: CardDashboard) {
  return cardCycleLink({ accountId: c.accountId, closingDate: c.closingDate!, closingDay: c.closingDay! });
}

// --- bloco 3: fluxo de caixa ------------------------------------------------------------------------------------

const cashflowOption = computed(() => (c: ThemeColors) => cashflowBars(cashflow.data.value?.monthly ?? [], c));
const forecastOption = computed(() => (c: ThemeColors) =>
  forecastLine(cashflow.data.value?.monthly ?? [], cashflow.data.value?.forecast ?? [], c));

const currentMonth = computed(() => {
  const m = cashflow.data.value?.monthly;
  return m && m.length ? m[m.length - 1] : null;
});
// "Neste mês" é o último mês da série (o mês de hoje), não o período do filtro.
const currentMonthLink = computed(() => (currentMonth.value ? monthLink(filter.value, currentMonth.value.month) : null));

function onCashflowClick(e: EChartClick) {
  const m = cashflow.data.value?.monthly[e.dataIndex];
  if (m) void router.push(monthLink(filter.value, m.month));
}

const consolidatedInsight = computed(() => {
  const c = cashflow.data.value?.balances.consolidated;
  return c ? `PF ${formatBRL(c.pfCents)} · PJ ${formatBRL(c.pjCents)}` : undefined;
});

const monthFlowInsight = computed(() => {
  const m = currentMonth.value;
  return m ? `Neste mês: receitas ${formatBRL(m.incomeCents)} · despesas ${formatBRL(m.expenseCents)}` : undefined;
});

const forecastEnd = computed(() => {
  const f = cashflow.data.value?.forecast;
  return f && f.length ? f[f.length - 1] : null;
});

const forecastInsight = computed(() => {
  const f = cashflow.data.value?.forecast[0];
  return f ? `Próximo mês: receita ${formatBRL(f.incomeCents)} · despesa ${formatBRL(f.expenseCents)}` : undefined;
});

const scoped = computed(() => filter.value.entity !== "all" || !!filter.value.accountId);

const balanceColumns = [
  { key: "name", label: "Conta" },
  { key: "entity", label: "Entidade" },
  { key: "balanceCents", label: "Saldo", align: "right" as const },
];
</script>

<template>
  <section class="painel">
    <header class="painel-head">
      <h2>Painel</h2>
      <FilterBar>
        <PeriodPicker :model-value="period" @update:model-value="onPeriod" />
        <select :value="filter.entity" aria-label="Entidade" @change="onEntity(($event.target as HTMLSelectElement).value as PainelEntity)">
          <option value="all">PF e PJ</option>
          <option value="pf">Pessoa Física</option>
          <option value="pj">Pessoa Jurídica</option>
        </select>
        <select :value="filter.accountId" aria-label="Conta" @change="onAccount(($event.target as HTMLSelectElement).value)">
          <option value="">Todas as contas</option>
          <option v-for="a in accountOptions" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
        </select>
      </FilterBar>
    </header>

    <!-- 1. Para onde vai o dinheiro -->
    <section class="block" aria-labelledby="sec-gastos" :aria-busy="spending.loading.value">
      <h3 id="sec-gastos" class="block-title">Para onde vai o dinheiro</h3>
      <div v-if="spending.error.value" class="state" role="alert">
        <p>{{ spending.error.value }}</p>
        <button type="button" @click="spending.run()">Tentar de novo</button>
      </div>
      <p v-else-if="!spending.data.value" class="state" role="status">Carregando…</p>
      <div v-else class="grid" :class="{ stale: spending.loading.value }">
        <Card
          class="span-2"
          :title="`Despesas · ${spending.data.value.period.label}`"
          :value="formatBRL(spending.data.value.totalCents)"
          :insight="spendingInsight"
          :to="periodLink"
        />
        <template v-if="spending.data.value.totalCents > 0">
          <Card title="Por categoria" :insight="`Anterior (${spending.data.value.previousPeriod.label}): ${formatBRL(spending.data.value.previousTotalCents)}`">
            <template #actions><RouterLink :to="periodLink" class="card-link">Ver transações</RouterLink></template>
            <EChart :option="pieOption" label="Despesas por categoria" :height="300" @click="onPieClick" />
          </Card>
          <Card
            title="Evolução mensal por categoria"
            :value="`${formatBRL(monthlyAverage)} por mês`"
            insight="Média dos últimos 12 meses até o fim do período."
          >
            <EChart :option="stackOption" label="Despesas por mês, empilhadas por categoria" :height="300" @click="onStackClick" />
          </Card>
          <Card title="Orçamento" :value="budgetSummary.value" :insight="budgetSummary.insight">
            <EChart
              v-if="spending.data.value.vsBudget.length"
              :option="budgetOption"
              label="Uso do orçamento por categoria"
              :height="Math.max(160, spending.data.value.vsBudget.length * 38 + 24)"
              @click="onBudgetClick"
            />
            <EmptyState v-else title="Nenhum orçamento fixo" hint="Defina limites em Orçamentos para acompanhar aqui." />
          </Card>
          <Card title="Maiores destinos" :insight="`${spending.data.value.topCounterparties.length} maiores no período`">
            <DataTable
              :columns="destinationColumns"
              :rows="spending.data.value.topCounterparties"
              caption="Maiores destinos de despesa no período"
              empty-title="Sem destinos no período"
            >
              <template #cell-totalCents="{ row }">{{ formatBRL(row.totalCents) }}</template>
            </DataTable>
          </Card>
          <Card
            class="span-2"
            title="Recorrentes"
            :value="spending.data.value.recurring.length ? `${formatBRL(recurringTotal)} por mês` : undefined"
            :insight="spending.data.value.recurring.length ? 'Despesas que se repetem nos últimos 12 meses.' : undefined"
          >
            <DataTable
              :columns="recurringColumns"
              :rows="spending.data.value.recurring"
              caption="Despesas recorrentes detectadas"
              empty-title="Nenhuma despesa recorrente"
              empty-hint="Aparecem quando há ao menos 3 ocorrências parecidas."
            >
              <template #cell-frequency="{ row }">{{ row.frequency === "monthly" ? "Mensal" : "Semanal" }}</template>
              <template #cell-avgCents="{ row }">{{ formatBRL(row.avgCents) }}</template>
              <template #cell-monthlyEstimateCents="{ row }">{{ formatBRL(row.monthlyEstimateCents) }}</template>
            </DataTable>
          </Card>
        </template>
        <EmptyState v-else class="span-2" title="Sem despesas no período" hint="Escolha outro período ou lance despesas para ver a distribuição." />
      </div>
    </section>

    <!-- 2. Cartões e faturas -->
    <section class="block" aria-labelledby="sec-cartoes" :aria-busy="cards.loading.value">
      <h3 id="sec-cartoes" class="block-title">Cartões e faturas</h3>
      <div v-if="cards.error.value" class="state" role="alert">
        <p>{{ cards.error.value }}</p>
        <button type="button" @click="cards.run()">Tentar de novo</button>
      </div>
      <p v-else-if="!cards.data.value" class="state" role="status">Carregando…</p>
      <EmptyState
        v-else-if="cards.data.value.cards.length === 0"
        title="Nenhum cartão de crédito"
        hint="Cadastre uma conta do tipo cartão de crédito com os dias de fechamento e de vencimento para acompanhar faturas e parcelas."
      >
        <RouterLink to="/contas" class="card-link">Ir para Contas</RouterLink>
      </EmptyState>
      <div v-else class="stack" :class="{ stale: cards.loading.value }">
        <template v-for="c in cards.data.value.cards" :key="c.accountId">
          <Card v-if="!c.configured" :title="c.name">
            <template #actions><EntityBadge :entity="c.entity" /></template>
            <EmptyState
              title="Fechamento e vencimento não configurados"
              hint="Informe o dia de fechamento e o de vencimento deste cartão para ver a fatura."
            >
              <RouterLink to="/contas" class="card-link">Configurar em Contas</RouterLink>
            </EmptyState>
          </Card>
          <Card
            v-else
            :title="c.name"
            :value="formatBRL(c.openInvoiceCents ?? 0)"
            :insight="cardInsight(c)"
          >
            <template #actions>
              <EntityBadge :entity="c.entity" />
              <RouterLink :to="cardLink(c)" class="card-link">Ver transações</RouterLink>
            </template>
            <div class="limit">
              <div
                v-if="c.limitUsedPct != null"
                class="bar"
                role="progressbar"
                aria-label="Limite utilizado"
                aria-valuemin="0"
                aria-valuemax="100"
                :aria-valuenow="Math.round(limitPct(c))"
              >
                <span :class="{ high: limitPct(c) >= 90 }" :style="{ width: `${limitPct(c)}%` }" />
              </div>
              <p class="limit-text">
                <template v-if="c.limitUsedPct != null && c.creditLimitCents != null">
                  {{ c.limitUsedPct }}% do limite · usado {{ formatBRL(c.usedCents) }} de {{ formatBRL(c.creditLimitCents) }}
                </template>
                <template v-else>Usado {{ formatBRL(c.usedCents) }} · limite não informado</template>
              </p>
            </div>
            <div class="grid inner">
              <div>
                <h4 class="sub">Ciclo atual × média dos anteriores</h4>
                <EChart :option="cardOptions.get(c.accountId)!.cycle" :label="`Gasto acumulado no ciclo do cartão ${c.name}`" :height="220" />
              </div>
              <div>
                <h4 class="sub">Parcelas nos próximos meses</h4>
                <EChart v-if="hasInstallments(c)" :option="cardOptions.get(c.accountId)!.installments" :label="`Parcelas a vencer do cartão ${c.name}`" :height="220" />
                <EmptyState v-else title="Sem parcelas a vencer" />
              </div>
            </div>
            <h4 class="sub">Faturas e pagamentos</h4>
            <DataTable
              :columns="paymentColumns"
              :rows="c.invoicePayments"
              :caption="`Faturas e pagamentos do cartão ${c.name}`"
              empty-title="Sem faturas fechadas"
            >
              <template #cell-closing="{ row }">{{ fmtDate(row.closing) }}</template>
              <template #cell-due="{ row }">{{ fmtDate(row.due) }}</template>
              <template #cell-invoiceCents="{ row }">{{ formatBRL(row.invoiceCents) }}</template>
              <template #cell-paidCents="{ row }">{{ formatBRL(row.paidCents) }}</template>
              <template #cell-status="{ row }"><span class="status" :class="row.status">{{ STATUS_LABEL[row.status] }}</span></template>
            </DataTable>
          </Card>
        </template>
      </div>
    </section>

    <!-- 3. Fluxo de caixa -->
    <section class="block" aria-labelledby="sec-fluxo" :aria-busy="cashflow.loading.value">
      <h3 id="sec-fluxo" class="block-title">Fluxo de caixa</h3>
      <div v-if="cashflow.error.value" class="state" role="alert">
        <p>{{ cashflow.error.value }}</p>
        <button type="button" @click="cashflow.run()">Tentar de novo</button>
      </div>
      <p v-else-if="!cashflow.data.value" class="state" role="status">Carregando…</p>
      <div v-else class="grid" :class="{ stale: cashflow.loading.value }">
        <Card
          title="Saldo consolidado (todas as contas)"
          :value="formatBRL(cashflow.data.value.balances.consolidated.totalCents)"
          :insight="consolidatedInsight"
        />
        <Card
          title="Saldo previsto em 3 meses"
          :value="forecastEnd ? formatBRL(forecastEnd.balanceCents) : undefined"
          :insight="forecastInsight"
        >
          <EChart :option="forecastOption" label="Saldo realizado e previsto" :height="220" />
        </Card>
        <Card class="span-2" title="Receitas, despesas e saldo" :insight="monthFlowInsight">
          <template #actions>
            <RouterLink v-if="currentMonthLink" :to="currentMonthLink" class="card-link">Ver transações do mês</RouterLink>
          </template>
          <p v-if="scoped && currentMonth && currentMonthLink" class="transfers">
            Transferências internas no mês:
            <strong>{{ formatBRL(currentMonth.transfersNetCents) }}</strong>
            · <RouterLink :to="currentMonthLink" class="card-link">ver lançamentos</RouterLink>
          </p>
          <EChart
            :option="cashflowOption"
            label="Receitas, despesas e saldo dos últimos 12 meses"
            :height="300"
            @click="onCashflowClick"
          />
        </Card>
        <Card class="span-2" title="Saldos por conta">
          <DataTable
            :columns="balanceColumns"
            :rows="cashflow.data.value.balances.accounts"
            caption="Saldo atual de cada conta"
            empty-title="Nenhuma conta"
            empty-hint="Cadastre uma conta em Contas para ver os saldos."
          >
            <template #cell-entity="{ row }"><EntityBadge :entity="row.entity" /></template>
            <template #cell-balanceCents="{ row }">{{ formatBRL(row.balanceCents) }}</template>
          </DataTable>
        </Card>
      </div>
    </section>
  </section>
</template>

<style scoped>
.painel { padding: calc(var(--space) * 3); max-width: 1200px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 4); }
.painel-head { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
.block { display: flex; flex-direction: column; gap: calc(var(--space) * 2); min-width: 0; }
.block-title { font-size: 1.1rem; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: calc(var(--space) * 2); }
.grid > * { min-width: 0; }
.grid .span-2 { grid-column: 1 / -1; }
.grid.inner { margin: calc(var(--space) * 2) 0; }
.stack { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
.stale { opacity: 0.6; transition: opacity 0.15s; }
.state { padding: calc(var(--space) * 3); color: var(--text-muted); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.state button { margin-top: var(--space); }
.card-link { font-size: 0.85rem; color: var(--accent); }
.sub { font-size: 0.8rem; font-weight: 600; color: var(--text-muted); margin: var(--space) 0; }
.limit { margin-top: var(--space); }
.bar { height: 8px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent); border-radius: 999px; }
.bar span.high { background: var(--danger); }
.limit-text { margin-top: calc(var(--space) * 0.5); font-size: 0.85rem; color: var(--text-muted); }
.transfers { margin-bottom: var(--space); font-size: 0.88rem; color: var(--text-muted); }
.transfers strong { color: var(--text); font-variant-numeric: tabular-nums; }
.status { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
.status.paid { color: var(--c-income); background: color-mix(in srgb, var(--c-income) 15%, transparent); }
.status.partial { color: var(--warning); background: color-mix(in srgb, var(--warning) 15%, transparent); }
.status.open { color: var(--c-transfer); background: color-mix(in srgb, var(--c-transfer) 15%, transparent); }
.status.overdue { color: var(--danger); background: color-mix(in srgb, var(--danger) 15%, transparent); }

@media (max-width: 768px) {
  .painel { padding: calc(var(--space) * 2); }
  .grid { grid-template-columns: 1fr; }
  .grid .span-2 { grid-column: auto; }
}
</style>
