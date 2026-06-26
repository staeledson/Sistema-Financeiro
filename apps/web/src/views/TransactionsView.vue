<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useFinanceStore } from "../stores/finance";
import type { TransactionType } from "../lib/api";

const store = useFinanceStore();

// filters
const filterFrom = ref("");
const filterTo = ref("");
const filterAccountId = ref("");
const filterQ = ref("");

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
const currentCategories = computed(() => txType.value === "income" ? incomeCategories.value : expenseCategories.value);

onMounted(async () => {
  await Promise.all([store.loadAccounts(), store.loadCategories(), store.loadTransactions()]);
  if (store.accounts.length > 0) txAccountId.value = store.accounts[0].id;
});

async function filtrar() {
  await store.loadTransactions({
    from: filterFrom.value || undefined,
    to: filterTo.value || undefined,
    accountId: filterAccountId.value || undefined,
    q: filterQ.value || undefined,
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

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
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
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <select v-model="txDstId">
            <option value="">— Destino —</option>
            <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>
      </template>

      <input v-model="txDesc" placeholder="Descrição (opcional)" />
      <button type="submit">Registrar</button>
      <p v-if="txErro" role="alert">{{ txErro }}</p>
    </form>

    <!-- Filters -->
    <div class="filters">
      <input v-model="filterFrom" type="date" placeholder="De" />
      <input v-model="filterTo" type="date" placeholder="Até" />
      <select v-model="filterAccountId">
        <option value="">Todas as contas</option>
        <option v-for="a in store.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <input v-model="filterQ" placeholder="Buscar descrição" />
      <button @click="filtrar">Filtrar</button>
    </div>

    <!-- List -->
    <ul class="tx-list">
      <li v-for="tx in store.transactions" :key="tx.id" class="tx-item" :class="tx.type">
        <div class="tx-info">
          <span class="tx-type">{{ txTypeLabel[tx.type] }}</span>
          <span class="tx-desc">{{ tx.description ?? "—" }}</span>
          <span class="tx-date">{{ formatDate(tx.date) }}</span>
        </div>
        <span class="tx-amount" :class="{ negative: tx.type === 'expense' }">
          {{ tx.type === 'expense' ? '−' : tx.type === 'income' ? '+' : '⇄' }}{{ formatBRL(tx.amountCents) }}
        </span>
      </li>
      <li v-if="store.transactions.length === 0" class="empty">Nenhuma transação encontrada.</li>
    </ul>
  </section>
</template>

<style scoped>
.transactions { padding: calc(var(--space) * 3); max-width: 720px; margin: 0 auto; }
h2, h3 { margin-bottom: calc(var(--space) * 2); }
.quick-form, .filters { background: var(--color-surface); padding: calc(var(--space) * 3); border-radius: var(--radius); margin-bottom: calc(var(--space) * 3); display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
.row { display: flex; gap: calc(var(--space) * 2); flex-wrap: wrap; }
.row > * { flex: 1; min-width: 120px; }
.filters { flex-direction: row; flex-wrap: wrap; align-items: center; }
.filters > * { flex: 1; min-width: 140px; }
input, select { padding: calc(var(--space) * 1.5); border: 1px solid #333; border-radius: calc(var(--radius) / 2); background: var(--color-bg); color: var(--color-text); font-size: 0.9rem; }
button { padding: calc(var(--space) * 1.5) calc(var(--space) * 2); border: none; border-radius: calc(var(--radius) / 2); background: var(--color-primary); color: #fff; cursor: pointer; white-space: nowrap; }
.tx-list { list-style: none; display: flex; flex-direction: column; gap: var(--space); }
.tx-item { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--space) * 2); background: var(--color-surface); border-radius: var(--radius); }
.tx-info { display: flex; gap: calc(var(--space) * 2); align-items: baseline; flex-wrap: wrap; }
.tx-type { font-size: 0.75rem; text-transform: uppercase; letter-spacing: .05em; opacity: 0.7; }
.tx-desc { font-weight: 500; }
.tx-date { font-size: 0.8rem; opacity: 0.5; }
.tx-amount { font-weight: 700; }
.tx-amount.negative { color: #e74c3c; }
.income .tx-amount { color: #2ecc71; }
.empty { opacity: 0.5; font-style: italic; padding: var(--space); }
p[role="alert"] { color: #e74c3c; font-size: 0.9rem; }
</style>
