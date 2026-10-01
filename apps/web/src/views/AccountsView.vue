<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useFinanceStore } from "../stores/finance";
import type { BankAccount } from "../lib/api";
import {
  ACCOUNT_TYPE_LABEL, INSTITUTION_LABEL, accountsForEntity,
  type EntityFilter,
} from "../lib/entity";
import {
  emptyAccountForm, formFromAccount, buildCreateAccountPayload, buildUpdateAccountPayload,
} from "../lib/account-form";
import AccountFields from "../components/AccountFields.vue";
import EntityBadge from "../components/ui/EntityBadge.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import Money from "../components/ui/Money.vue";
import { formatBRL } from "../lib/money";

const store = useFinanceStore();
const filtro = ref<EntityFilter>("all");
const novo = ref(emptyAccountForm());
const editId = ref<string | null>(null);
const edicao = ref(emptyAccountForm());
const erro = ref("");

const filtros: { value: EntityFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pf", label: "PF" },
  { value: "pj", label: "PJ" },
];

const visiveis = computed(() => accountsForEntity(store.accounts, filtro.value));

function saldoDe(acc: BankAccount): number {
  return store.balances?.accounts.find((b) => b.accountId === acc.id)?.balanceCents ?? acc.openingBalanceCents;
}
const saldoVisivel = computed(() => visiveis.value.reduce((s, a) => s + saldoDe(a), 0));

onMounted(async () => {
  await Promise.all([store.loadAccounts(), store.loadBalances()]);
});

async function criar() {
  erro.value = "";
  if (!novo.value.name.trim()) { erro.value = "Nome obrigatório"; return; }
  try {
    await store.createAccount(buildCreateAccountPayload(novo.value));
    await store.loadBalances();
    novo.value = emptyAccountForm();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

function iniciarEdicao(acc: BankAccount) {
  erro.value = "";
  editId.value = acc.id;
  edicao.value = formFromAccount(acc);
}

function cancelarEdicao() {
  editId.value = null;
}

async function salvarEdicao() {
  if (!editId.value) return;
  erro.value = "";
  if (!edicao.value.name.trim()) { erro.value = "Nome obrigatório"; return; }
  try {
    await store.updateAccount(editId.value, buildUpdateAccountPayload(edicao.value));
    editId.value = null;
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

async function arquivar(id: string) {
  await store.archiveAccount(id);
  await store.loadBalances();
}

function detalhe(acc: BankAccount): string {
  const partes = [INSTITUTION_LABEL[acc.institution], ACCOUNT_TYPE_LABEL[acc.type]];
  if (acc.externalId) partes.push(`final ${acc.externalId}`);
  return partes.join(" · ");
}

function detalheCartao(acc: BankAccount): string | null {
  if (acc.type !== "credit_card") return null;
  const partes: string[] = [];
  if (acc.closingDay) partes.push(`fecha dia ${acc.closingDay}`);
  if (acc.dueDay) partes.push(`vence dia ${acc.dueDay}`);
  if (acc.creditLimitCents != null) partes.push(`limite ${formatBRL(acc.creditLimitCents)}`);
  return partes.length ? partes.join(" · ") : null;
}
</script>

<template>
  <section class="accounts">
    <h2>Contas</h2>

    <div class="entity-filter" role="group" aria-label="Filtrar por entidade">
      <button
        v-for="f in filtros"
        :key="f.value"
        type="button"
        :class="{ active: filtro === f.value }"
        @click="filtro = f.value"
      >{{ f.label }}</button>
    </div>

    <div class="consolidated" v-if="store.balances">
      Saldo {{ filtro === 'all' ? 'consolidado' : filtro.toUpperCase() }}: <strong><Money :cents="saldoVisivel" /></strong>
    </div>

    <ul class="account-list">
      <li v-for="acc in visiveis" :key="acc.id" class="account-item">
        <template v-if="editId === acc.id">
          <form class="edit-form" @submit.prevent="salvarEdicao">
            <AccountFields v-model="edicao" lock-type />
            <div class="edit-actions">
              <button type="submit">Salvar</button>
              <button type="button" class="btn-secondary btn-small" @click="cancelarEdicao">Cancelar</button>
            </div>
          </form>
        </template>
        <template v-else>
          <div class="account-info">
            <span class="account-name">{{ acc.name }}</span>
            <span class="account-type"><EntityBadge :entity="acc.entity" /> {{ detalhe(acc) }}</span>
            <span v-if="detalheCartao(acc)" class="account-type">{{ detalheCartao(acc) }}</span>
          </div>
          <div class="account-actions">
            <Money class="balance" :cents="saldoDe(acc)" />
            <button type="button" class="btn-secondary btn-small" @click="iniciarEdicao(acc)">Editar</button>
            <button type="button" class="btn-danger btn-small" @click="arquivar(acc.id)">Arquivar</button>
          </div>
        </template>
      </li>
      <li v-if="visiveis.length === 0" class="empty"><EmptyState title="Nenhuma conta ativa." /></li>
    </ul>

    <form class="create-form" @submit.prevent="criar">
      <h3>Nova conta</h3>
      <AccountFields v-model="novo" show-opening-balance />
      <button type="submit">Criar</button>
    </form>
    <p v-if="erro" role="alert" class="text-error">{{ erro }}</p>
  </section>
</template>

<style scoped>
.accounts { padding: calc(var(--space) * 3); max-width: 640px; margin: 0 auto; }
h2, h3 { margin-bottom: calc(var(--space) * 2); }
.entity-filter { display: flex; gap: var(--space); margin-bottom: calc(var(--space) * 2); }
.entity-filter button { background: var(--surface-2); color: var(--text); border-color: var(--border); }
.entity-filter button.active { background: var(--accent); color: var(--accent-text); border-color: transparent; }
.consolidated { margin-bottom: calc(var(--space) * 3); font-size: 1.1rem; }
.account-list { list-style: none; display: flex; flex-direction: column; gap: var(--space); margin-bottom: calc(var(--space) * 4); }
.account-item { display: flex; justify-content: space-between; align-items: center; padding: calc(var(--space) * 2); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); gap: calc(var(--space) * 2); }
.account-info { display: flex; flex-direction: column; gap: 4px; }
.account-name { font-weight: 600; }
.account-type { font-size: 0.8rem; color: var(--text-muted); }
.account-actions { display: flex; align-items: center; gap: calc(var(--space) * 2); flex-wrap: wrap; justify-content: flex-end; }
.balance { font-weight: 600; }
.empty { list-style: none; }
.create-form, .edit-form { display: flex; flex-direction: column; gap: calc(var(--space) * 2); width: 100%; }
.create-form { background: var(--surface); border: 1px solid var(--border); padding: calc(var(--space) * 3); border-radius: var(--radius); }
.edit-actions { display: flex; gap: var(--space); }
p[role="alert"] { font-size: 0.9rem; margin-top: calc(var(--space) * 2); }
</style>
