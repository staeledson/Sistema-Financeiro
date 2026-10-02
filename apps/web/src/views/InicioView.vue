<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { api } from "../lib/api";
import {
  categoryLink, expensesMonthLink, isValidMonth, localToday, monthLabel, monthName, previousMonthOf, type PainelFilter,
} from "../lib/dashboard-client";
import { averageMonthlyCents, budgetBars, PALETTE_SIZE, pieSlices, spendingPie, spendingStack, totalStackCents } from "../lib/dashboard-charts";
import { formatDate } from "../lib/import-client";
import { breakdownFor, type BreakdownKind } from "../lib/balance-breakdown";
import { ACCOUNT_TYPE_LABEL, INSTITUTION_LABEL } from "../lib/entity";
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

// Saldos, pendências e próxima fatura são sempre "hoje"; os gastos são de um mês, por padrão o anterior ao atual
// (o último completo: extratos e faturas costumam ser importados depois da virada). Não é guardado em lugar nenhum.
const currentMonth = localToday().slice(0, 7);
const month = ref(previousMonthOf(currentMonth));
const summary = useSection(() => api.summary(localToday(), month.value));
const onInicio = () => route.path === "/";

onMounted(() => {
  void summary.run();
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
// Troca de workspace: os números são de outro workspace.
watch(() => workspace.activeId, () => onInicio() && void summary.run());

function onMonth(e: Event) {
  const input = e.target as HTMLInputElement;
  const next = input.value;
  // Vazio/inválido (ou no futuro): mantém o mês anterior e devolve o valor ao campo.
  if (!isValidMonth(next) || next > currentMonth) {
    input.value = month.value;
    return;
  }
  if (next === month.value) return;
  month.value = next;
  void summary.run();
}

// Filtro usado só para montar os links da lista de transações (o mês escolhido, tudo).
const monthFilter = computed<PainelFilter>(() => ({ entity: "all", accountId: "", month: month.value }));

const monthExpensesLink = computed(() => expensesMonthLink(monthFilter.value, month.value));
const monthTitle = computed(() => monthName(month.value));

const data = computed(() => summary.data.value);
const spending = computed(() => data.value?.spending ?? null);
const pieItems = computed(() => pieSlices(spending.value?.byCategory ?? [], PALETTE_SIZE));
const pieOption = computed(() => (c: ThemeColors) => spendingPie(spending.value?.byCategory ?? [], c));
const stackOption = computed(() => (c: ThemeColors) => spendingStack(spending.value?.byMonth ?? { months: [], series: [] }, c));
const budgetOption = computed(() => (c: ThemeColors) => budgetBars(spending.value?.vsBudget ?? [], c));
const stackTotal = computed(() => (spending.value ? totalStackCents(spending.value.byMonth) : 0));
const stackAverage = computed(() => (spending.value ? averageMonthlyCents(spending.value.byMonth) : 0));

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

// Detalhe dos saldos: um painel por vez, aberto pelo cartão clicado (clicar de novo, Escape ou Fechar recolhe).
const DETAIL_ID = "inicio-detalhe";
const openKind = ref<BreakdownKind | null>(null);
const triggers = new Map<BreakdownKind, HTMLButtonElement>();
const detail = computed(() => (openKind.value && data.value ? breakdownFor(openKind.value, data.value.accounts ?? []) : null));

function setTrigger(kind: BreakdownKind) {
  return (el: unknown) => {
    if (el instanceof HTMLButtonElement) triggers.set(kind, el);
    else triggers.delete(kind);
  };
}

function toggleDetail(kind: BreakdownKind) {
  openKind.value = openKind.value === kind ? null : kind;
}

/** Fecha o painel e devolve o foco ao cartão que o abriu (quem usa teclado não se perde). */
function closeDetail() {
  const kind = openKind.value;
  if (!kind) return;
  openKind.value = null;
  void nextTick(() => triggers.get(kind)?.focus());
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && openKind.value) closeDetail();
}

const cardDays = (a: { closingDay: number | null; dueDay: number | null }) =>
  a.closingDay != null && a.dueDay != null ? `fecha dia ${a.closingDay} · vence dia ${a.dueDay}` : null;

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
        <button
          type="button" class="bal" data-kind="pf" :class="{ open: openKind === 'pf' }"
          :aria-expanded="openKind === 'pf'" :aria-controls="DETAIL_ID" :ref="setTrigger('pf')" @click="toggleDetail('pf')"
        >
          <span class="bal-head"><span class="bal-title">Pessoa Física</span><EntityBadge entity="pf" /></span>
          <span class="big"><Money :cents="data.balances.pfCents" colored /></span>
          <span class="hint">ver detalhe <span class="chev" aria-hidden="true">▾</span></span>
        </button>
        <button
          type="button" class="bal" data-kind="pj" :class="{ open: openKind === 'pj' }"
          :aria-expanded="openKind === 'pj'" :aria-controls="DETAIL_ID" :ref="setTrigger('pj')" @click="toggleDetail('pj')"
        >
          <span class="bal-head"><span class="bal-title">Pessoa Jurídica</span><EntityBadge entity="pj" /></span>
          <span class="big"><Money :cents="data.balances.pjCents" colored /></span>
          <span class="hint">ver detalhe <span class="chev" aria-hidden="true">▾</span></span>
        </button>
        <button
          type="button" class="bal" data-kind="total" :class="{ open: openKind === 'total' }"
          :aria-expanded="openKind === 'total'" :aria-controls="DETAIL_ID" :ref="setTrigger('total')" @click="toggleDetail('total')"
        >
          <span class="bal-head"><span class="bal-title">Saldo total em contas</span></span>
          <span class="big"><Money :cents="data.balances.totalCents" colored /></span>
          <span class="hint">ver detalhe <span class="chev" aria-hidden="true">▾</span></span>
        </button>
      </section>

      <!-- Dívida dos cartões: fica fora do saldo em contas (é gasto futuro, não caixa). -->
      <section v-if="data.balances.cards.totalCents !== 0" class="cards-owed" aria-label="Cartões a pagar">
        <button
          type="button" class="bal" data-kind="cards" :class="{ open: openKind === 'cards' }"
          :aria-expanded="openKind === 'cards'" :aria-controls="DETAIL_ID" :ref="setTrigger('cards')" @click="toggleDetail('cards')"
        >
          <span class="bal-head"><span class="bal-title">Cartões a pagar</span></span>
          <span class="big"><Money :cents="data.balances.cards.totalCents" colored /></span>
          <span class="note">PF {{ formatBRL(data.balances.cards.pfCents) }} · PJ {{ formatBRL(data.balances.cards.pjCents) }}</span>
          <span class="hint">ver detalhe <span class="chev" aria-hidden="true">▾</span></span>
        </button>
      </section>

      <section v-if="detail" :id="DETAIL_ID" class="detail" aria-labelledby="inicio-detalhe-titulo">
        <header class="detail-head">
          <h3 id="inicio-detalhe-titulo" class="block-title">Detalhe — {{ detail.title }}: <Money :cents="detail.totalCents" colored /></h3>
          <button type="button" class="detail-close" @click="closeDetail">Fechar</button>
        </header>

        <p v-if="detail.groups.length === 0" class="note">
          Nenhuma conta para detalhar. <RouterLink to="/contas">Cadastre ou ajuste suas contas</RouterLink>.
        </p>

        <div v-for="g in detail.groups" :key="g.label" class="table-wrap">
          <table class="detail-table">
            <caption>
              <span class="cap">{{ openKind === "cards" ? "Cartões" : "Contas" }} — {{ g.label }}</span>
              <EntityBadge v-if="g.entity" :entity="g.entity" />
            </caption>
            <thead>
              <tr>
                <th scope="col">Conta</th>
                <th scope="col">Instituição</th>
                <th scope="col" class="num">Saldo</th>
                <th scope="col"><span class="vh">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="a in g.accounts" :key="a.accountId" :class="{ zero: a.balanceCents === 0 }">
                <th scope="row" class="acc">
                  <span class="acc-name">{{ a.name }}</span>
                  <EntityBadge :entity="a.entity" />
                  <span class="acc-type">{{ ACCOUNT_TYPE_LABEL[a.type] }}</span>
                  <span v-if="cardDays(a)" class="acc-days">{{ cardDays(a) }}</span>
                </th>
                <td>{{ INSTITUTION_LABEL[a.institution] }}</td>
                <td class="num"><Money :cents="a.balanceCents" colored /></td>
                <td class="links">
                  <RouterLink :to="`/transacoes?accountId=${a.accountId}`" :aria-label="`Ver lançamentos de ${a.name}`">Ver lançamentos</RouterLink>
                  <RouterLink to="/contas" :aria-label="`Conciliar saldo de ${a.name}`">Conciliar saldo</RouterLink>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colspan="2">Subtotal — {{ g.label }}</th>
                <td class="num"><Money :cents="g.subtotalCents" colored /></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div v-if="detail.groups.length > 1" class="table-wrap">
          <table class="detail-table total-table">
            <caption class="vh">Total</caption>
            <tfoot>
              <tr>
                <th scope="row">Total — {{ detail.title }}</th>
                <td class="num"><Money :cents="detail.totalCents" colored /></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p v-if="openKind === 'cards'" class="note">
          Valor devido de cada cartão (fatura aberta + parcelas lançadas); detalhes da fatura no
          <RouterLink :to="{ path: '/painel', hash: '#sec-cartoes' }">Painel</RouterLink>.
        </p>
        <p v-else class="note">Cartões não entram no saldo em contas; veja Cartões a pagar.</p>
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
            <p v-if="data.nextInvoice.estimated" class="note">Saldo devedor do cartão (a fatura ainda não tem lançamentos importados)</p>
          </template>
          <p v-else-if="data.cardsConfigured" class="note">Nenhuma fatura a vencer.</p>
          <p v-else class="note">Nenhuma fatura a vencer. Cartões precisam de dias de fechamento e vencimento em Contas.</p>
        </Card>
      </section>

      <section class="spending" aria-labelledby="sec-inicio-gastos">
        <div class="spending-head">
          <h3 id="sec-inicio-gastos" class="block-title">Para onde foi o dinheiro em {{ monthLabel(month) }}</h3>
          <div class="month-pick">
            <label for="inicio-mes">Mês</label>
            <input id="inicio-mes" type="month" :value="month" :max="currentMonth" @change="onMonth" />
          </div>
        </div>
        <Card :title="`Despesas de ${monthTitle}`" :value="formatBRL(data.spending.totalCents)" :insight="spendingInsight" :to="monthExpensesLink" />
        <div v-if="data.spending.totalCents > 0" class="grid two">
          <Card title="Por categoria">
            <EChart :option="pieOption" :label="`Despesas de ${monthTitle} por categoria`" :height="280" @click="onPieClick" />
          </Card>
          <Card
            title="Evolução mensal por categoria"
            :value="formatBRL(stackTotal)"
            :insight="`Total dos últimos 12 meses · média de ${formatBRL(stackAverage)} por mês.`"
          >
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
        <EmptyState v-else :title="`Sem despesas em ${monthTitle}`" hint="Importe um extrato ou lance despesas para ver a distribuição." />
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
.spending-head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--space) * 2); flex-wrap: wrap; }
.month-pick { display: flex; align-items: center; gap: var(--space); font-size: 0.85rem; color: var(--text-muted); }
.block-title { font-size: 1.1rem; }
.big { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-size: 1.6rem; font-weight: 700; }
.note { margin-top: calc(var(--space) * 0.5); font-size: 0.85rem; color: var(--text-muted); }
.bal {
  display: flex; flex-direction: column; gap: calc(var(--space) * 0.5); width: 100%; text-align: left; font: inherit; color: var(--text); cursor: pointer;
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: calc(var(--space) * 2);
}
.bal:hover, .bal.open { border-color: var(--accent); }
.bal:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.bal-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space); }
.bal-title { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
.bal .note { margin-top: 0; }
.hint { font-size: 0.75rem; color: var(--text-muted); }
.bal:hover .hint, .bal.open .hint { color: var(--accent); }
.chev { display: inline-block; transition: transform 0.15s; }
.bal.open .chev { transform: rotate(180deg); }
.detail { display: flex; flex-direction: column; gap: calc(var(--space) * 2); min-width: 0; background: var(--surface); border: 1px solid var(--accent); border-radius: var(--radius); padding: calc(var(--space) * 2); }
.detail-head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--space) * 2); flex-wrap: wrap; }
.detail-close { padding: calc(var(--space) * 0.5) calc(var(--space) * 1.5); }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: calc(var(--radius) / 1.5); }
.detail-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.detail-table caption { display: flex; align-items: center; gap: var(--space); text-align: left; padding: var(--space) calc(var(--space) * 1.5); font-weight: 600; }
.detail-table th, .detail-table td { padding: var(--space) calc(var(--space) * 1.5); text-align: left; border-top: 1px solid var(--border); vertical-align: top; }
.detail-table thead th { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; }
.detail-table th[scope="row"] { font-weight: 400; }
.detail-table .num { text-align: right; white-space: nowrap; }
.detail-table tfoot th, .detail-table tfoot td { font-weight: 700; }
.acc { display: flex; flex-wrap: wrap; align-items: center; gap: calc(var(--space) * 0.5) var(--space); min-width: 220px; }
.acc-name { font-weight: 600; }
.acc-type, .acc-days { font-size: 0.8rem; color: var(--text-muted); }
.acc-days { flex-basis: 100%; }
tr.zero { opacity: 0.55; }
.links { display: flex; flex-direction: column; gap: calc(var(--space) * 0.5); white-space: nowrap; font-size: 0.85rem; }
.links a, .note a { color: var(--accent); }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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
