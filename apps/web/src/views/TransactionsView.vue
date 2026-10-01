<script setup lang="ts">
import { ref, onMounted, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useFinanceStore } from "../stores/finance";
import type { Transaction, TransactionType } from "../lib/api";
import EntityBadge from "../components/ui/EntityBadge.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import Money from "../components/ui/Money.vue";
import { ENTITY_SHORT, accountsForEntity, categoriesForEntity, type EntityFilter } from "../lib/entity";

const store = useFinanceStore();
const route = useRoute();
const router = useRouter();

// filters
const filterFrom = ref("");
const filterTo = ref("");
const filterAccountId = ref("");
const filterQ = ref("");
const filterEntity = ref<EntityFilter>("all");
const filterCategoryId = ref("");
const filterType = ref<TransactionType | "">("");
const filterReportable = ref(false);
const filterCategoryName = computed(() =>
  filterCategoryId.value === "__none" ? "Sem categoria" : (store.categories.find((c) => c.id === filterCategoryId.value)?.name ?? ""),
);

function queryValue(v: unknown): string {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : "";
}

/** Alimenta os filtros com `from/to/categoryId/accountId/entity/q` da URL (links do Painel); campos ausentes limpam o filtro. */
function applyRouteQuery() {
  const q = route.query;
  filterFrom.value = queryValue(q.from);
  filterTo.value = queryValue(q.to);
  filterCategoryId.value = queryValue(q.categoryId);
  const type = queryValue(q.type);
  filterType.value = type === "income" || type === "expense" || type === "transfer" ? type : "";
  // `reportable` só vale com type income/expense (a API devolve 400 nos demais casos)
  filterReportable.value = queryValue(q.reportable) === "1" && (filterType.value === "income" || filterType.value === "expense");
  filterAccountId.value = queryValue(q.accountId);
  filterQ.value = queryValue(q.q);
  const entity = queryValue(q.entity);
  filterEntity.value = entity === "pf" || entity === "pj" ? entity : "all";
}

// new transaction form
const txType = ref<TransactionType>("expense");
const txAmount = ref(0);
const txDate = ref(new Date().toISOString().slice(0, 10));
const txAccountId = ref("");
const txSrcId = ref("");
const txDstId = ref("");
const txCategoryId = ref("");
const txDesc = ref("");
const txErro = ref("");

const incomeCategories = computed(() => store.categories.filter((c) => c.type === "income"));
const expenseCategories = computed(() => store.categories.filter((c) => c.type === "expense"));
const formAccountEntity = computed(() => store.accounts.find((a) => a.id === txAccountId.value)?.entity);
const currentCategories = computed(() =>
  categoriesForEntity(txType.value === "income" ? incomeCategories.value : expenseCategories.value, formAccountEntity.value),
);
const filterAccounts = computed(() => accountsForEntity(store.accounts, filterEntity.value));

// trocar a conta ou o tipo pode invalidar a categoria já escolhida
watch(currentCategories, (list) => {
  if (txCategoryId.value && !list.some((c) => c.id === txCategoryId.value)) txCategoryId.value = "";
});

function entityOf(tx: Transaction) {
  return store.accounts.find((a) => a.id === (tx.accountId ?? tx.sourceAccountId))?.entity;
}

async function onEntityChange() {
  if (filterAccountId.value && !filterAccounts.value.some((a) => a.id === filterAccountId.value)) {
    filterAccountId.value = "";
  }
  await filtrar();
}

onMounted(async () => {
  applyRouteQuery();
  await Promise.all([store.loadAccounts(), store.loadCategories(), filtrar()]);
  if (store.accounts.length > 0) txAccountId.value = store.accounts[0].id;
});

// Navegar de um link do Painel para esta mesma tela (sem remontar) reaplica os filtros.
watch(
  () => route.query,
  async () => {
    if (route.path !== "/transacoes") return;
    applyRouteQuery();
    await filtrar();
  },
);

/** Remove categoria, tipo e "reportable" da URL; o watcher da rota reaplica os filtros e recarrega a lista. */
async function limparCategoria() {
  const { categoryId: _c, type: _t, reportable: _r, ...rest } = route.query;
  await router.replace({ query: rest });
}

async function filtrar() {
  await store.loadTransactions({
    categoryId: filterCategoryId.value || undefined,
    type: filterType.value || undefined,
    reportable: filterReportable.value || undefined,
    from: filterFrom.value || undefined,
    to: filterTo.value || undefined,
    accountId: filterAccountId.value || undefined,
    q: filterQ.value || undefined,
    entity: filterEntity.value === "all" ? undefined : filterEntity.value,
  });
}

async function registrar() {
  txErro.value = "";
  if (!txAmount.value || txAmount.value <= 0) { txErro.value = "Valor inválido"; return; }
  try {
    const body: Parameters<typeof store.createTransaction>[0] = {
      type: txType.value,
      amountCents: Math.round(txAmount.value * 100),
      date: txDate.value,
      description: txDesc.value || null,
    };
    if (txType.value === "transfer") {
      body.sourceAccountId = txSrcId.value || null;
      body.destAccountId = txDstId.value || null;
    } else {
      body.accountId = txAccountId.value || null;
      body.categoryId = txCategoryId.value || null;
    }
    await store.createTransaction(body);
    txAmount.value = 0;
    txDesc.value = "";
    txCategoryId.value = "";
  } catch (e) {
    txErro.value = (e as Error).message;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

const txTypeLabel: Record<TransactionType, string> = { income: "Receita", expense: "Despesa", transfer: "Transferência" };
</script>

<template>
  <section class="transactions">
    <h2>Transações</h2>

    <!-- Quick entry form -->
    <form class="quick-form" @submit.prevent="registrar">
      <h3>Lançar</h3>
      <div class="row">
        <select v-model="txType">
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
          <option value="transfer">Transferência</option>
        </select>
        <input v-model.number="txAmount" type="number" step="0.01" placeholder="Valor (R$)" required />
        <input v-model="txDate" type="date" required />
      </div>

      <template v-if="txType !== 'transfer'">
        <div class="row">
          <select v-model="txAccountId">
            <option value="">— Conta —</option>
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
          </select>
          <select v-model="txCategoryId">
            <option value="">— Categoria —</option>
            <option v-for="c in currentCategories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
      </template>
      <template v-else>
        <div class="row">
          <select v-model="txSrcId">
            <option value="">— Origem —</option>
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
          </select>
          <select v-model="txDstId">
            <option value="">— Destino —</option>
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
          </select>
        </div>
      </template>

      <input v-model="txDesc" placeholder="Descrição (opcional)" />
      <button type="submit">Registrar</button>
      <p v-if="txErro" role="alert" class="text-error">{{ txErro }}</p>
    </form>

    <!-- Filters -->
    <div class="filters">
      <input v-model="filterFrom" type="date" placeholder="De" />
      <input v-model="filterTo" type="date" placeholder="Até" />
      <select v-model="filterEntity" aria-label="Entidade" @change="onEntityChange">
        <option value="all">PF e PJ</option>
        <option value="pf">Pessoa Física</option>
        <option value="pj">Pessoa Jurídica</option>
      </select>
      <select v-model="filterAccountId">
        <option value="">Todas as contas</option>
        <option v-for="a in filterAccounts" :key="a.id" :value="a.id">{{ a.name }} · {{ ENTITY_SHORT[a.entity] }}</option>
      </select>
      <input v-model="filterQ" placeholder="Buscar descrição" />
      <button type="button" @click="filtrar">Filtrar</button>
    </div>
    <p v-if="filterCategoryId" class="category-chip">
      Categoria: <strong>{{ filterCategoryName || "selecionada" }}</strong>
      <span v-if="filterReportable">(despesas, sem transferências internas nem ignoradas)</span>
      <button type="button" aria-label="Remover filtro de categoria" @click="limparCategoria">Limpar</button>
    </p>

    <!-- List -->
    <ul class="tx-list">
      <li v-for="tx in store.transactions" :key="tx.id" class="tx-item" :class="tx.type">
        <div class="tx-info">
          <span class="tx-type">{{ txTypeLabel[tx.type] }}</span>
          <EntityBadge v-if="entityOf(tx)" :entity="entityOf(tx)!" />
          <span class="tx-desc">{{ tx.description ?? "—" }}</span>
          <span class="tx-date">{{ formatDate(tx.date) }}</span>
        </div>
        <span class="tx-amount" :class="{ negative: tx.type === 'expense' }">
          {{ tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : '⇄' }}<Money :cents="tx.amountCents" />
        </span>
      </li>
      <li v-if="store.transactions.length === 0" class="empty"><EmptyState title="Nenhuma transação encontrada." /></li>
    </ul>
  </section>
</template>

<style scoped>
.transactions { padding: calc(var(--space) * 3); max-width: 720px; margin: 0 auto; }
h2, h3 { margin-bottom: calc(var(--space) * 2); }
.quick-form, .filters { background: var(--surface); border: 1px solid var(--border); padding: calc(var(--space) * 3); border-radius: var(--radius); margin-bottom: calc(var(--space) * 3); display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
.row { display: flex; gap: calc(var(--space) * 2); flex-wrap: wrap; }
.row > * { flex: 1; min-width: 120px; }
.filters { flex-direction: row; flex-wrap: wrap; align-items: center; }
.filters > * { flex: 1; min-width: 140px; }
button { white-space: nowrap; }
.tx-list { list-style: none; display: flex; flex-direction: column; gap: var(--space); }
.tx-item { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--space) * 2); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); }
.tx-info { display: flex; gap: calc(var(--space) * 2); align-items: baseline; flex-wrap: wrap; }
.tx-type { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); }
.tx-desc { font-weight: 500; }
.tx-date { font-size: 0.8rem; color: var(--text-muted); }
.tx-amount { font-weight: 700; font-variant-numeric: tabular-nums; }
.tx-amount.negative { color: var(--c-expense); }
.income .tx-amount { color: var(--c-income); }
.empty { list-style: none; }
.category-chip { display: flex; align-items: center; gap: var(--space); margin-bottom: calc(var(--space) * 2); font-size: 0.9rem; color: var(--text-muted); }
p[role="alert"] { font-size: 0.9rem; }
</style>
