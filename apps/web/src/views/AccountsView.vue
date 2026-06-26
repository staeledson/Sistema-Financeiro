<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useFinanceStore } from "../stores/finance";
import type { AccountType } from "../lib/api";

const store = useFinanceStore();
const nome = ref("");
const tipo = ref<AccountType>("checking");
const saldoInicial = ref(0);
const erro = ref("");
const tipos: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Conta corrente" },
  { value: "savings", label: "Poupança" },
  { value: "credit_card", label: "Cartão de crédito" },
  { value: "cash", label: "Dinheiro" },
  { value: "investment", label: "Investimento" },
];

onMounted(async () => {
  await Promise.all([store.loadAccounts(), store.loadBalances()]);
});

async function criar() {
  erro.value = "";
  if (!nome.value.trim()) { erro.value = "Nome obrigatório"; return; }
  try {
    await store.createAccount({ type: tipo.value, name: nome.value, openingBalanceCents: Math.round(saldoInicial.value * 100) });
    await store.loadBalances();
    nome.value = "";
    saldoInicial.value = 0;
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

async function arquivar(id: string) {
  await store.archiveAccount(id);
  await store.loadBalances();
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
</script>

<template>
  <section class="accounts">
    <h2>Contas</h2>

    <div class="consolidated" v-if="store.balances">
      Saldo consolidado: <strong>{{ formatBRL(store.balances.consolidatedCents) }}</strong>
    </div>

    <ul class="account-list">
      <li v-for="acc in store.accounts" :key="acc.id" class="account-item">
        <div class="account-info">
          <span class="account-name">{{ acc.name }}</span>
          <span class="account-type">{{ tipos.find(t => t.value === acc.type)?.label }}</span>
        </div>
        <div class="account-actions">
          <span class="balance">
            {{ formatBRL(store.balances?.accounts.find(b => b.accountId === acc.id)?.balanceCents ?? acc.openingBalanceCents) }}
          </span>
          <button class="btn-danger" @click="arquivar(acc.id)">Arquivar</button>
        </div>
      </li>
      <li v-if="store.accounts.length === 0" class="empty">Nenhuma conta ativa.</li>
    </ul>

    <form class="create-form" @submit.prevent="criar">
      <h3>Nova conta</h3>
      <select v-model="tipo">
        <option v-for="t in tipos" :key="t.value" :value="t.value">{{ t.label }}</option>
      </select>
      <input v-model="nome" placeholder="Nome" />
      <input v-model.number="saldoInicial" type="number" step="0.01" placeholder="Saldo inicial (R$)" />
      <button type="submit">Criar</button>
      <p v-if="erro" role="alert">{{ erro }}</p>
    </form>
  </section>
</template>

<style scoped>
.accounts { padding: calc(var(--space) * 3); max-width: 640px; margin: 0 auto; }
h2, h3 { margin-bottom: calc(var(--space) * 2); }
.consolidated { margin-bottom: calc(var(--space) * 3); font-size: 1.1rem; }
.account-list { list-style: none; display: flex; flex-direction: column; gap: var(--space); margin-bottom: calc(var(--space) * 4); }
.account-item { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--space) * 2); background: var(--color-surface); border-radius: var(--radius); }
.account-info { display: flex; flex-direction: column; gap: 4px; }
.account-name { font-weight: 600; }
.account-type { font-size: 0.8rem; opacity: 0.6; }
.account-actions { display: flex; align-items: center; gap: calc(var(--space) * 2); }
.balance { font-weight: 600; }
.empty { opacity: 0.5; font-style: italic; padding: var(--space); }
.create-form { display: flex; flex-direction: column; gap: calc(var(--space) * 2); background: var(--color-surface); padding: calc(var(--space) * 3); border-radius: var(--radius); }
input, select { padding: calc(var(--space) * 1.5); border: 1px solid #333; border-radius: calc(var(--radius) / 2); background: var(--color-bg); color: var(--color-text); font-size: 1rem; }
button { padding: calc(var(--space) * 1.5); border: none; border-radius: calc(var(--radius) / 2); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 1rem; }
.btn-danger { background: #c0392b; padding: calc(var(--space) * 0.75) calc(var(--space) * 1.5); font-size: 0.85rem; }
p[role="alert"] { color: #e74c3c; font-size: 0.9rem; }
</style>
