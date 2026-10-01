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
import { formatAdjustment, parseMoneyInput } from "../lib/money-input";
import { futureActivity } from "../lib/reconcile";
import { localTodayISO } from "../lib/date";

const store = useFinanceStore();
const filtro = ref<EntityFilter>("all");
const novo = ref(emptyAccountForm());
const editId = ref<string | null>(null);
const edicao = ref(emptyAccountForm());
const erro = ref("");
const conciliarId = ref<string | null>(null);
const saldoReal = ref("");
const conciliando = ref(false);
const aviso = ref("");

const filtros: { value: EntityFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "pf", label: "PF" },
  { value: "pj", label: "PJ" },
];

const visiveis = computed(() => accountsForEntity(store.accounts, filtro.value));

function saldoDe(acc: BankAccount): number {
  return store.balances?.accounts.find((b) => b.accountId === acc.id)?.balanceCents ?? acc.openingBalanceCents;
}
// Saldo em contas = caixa (sem cartões de crédito); a dívida dos cartões é mostrada à parte.
// Sem filtro usa os totais da API; com PF/PJ soma as contas visíveis.
const saldoVisivel = computed(() => {
  if (filtro.value === "all" && store.balances) return store.balances.consolidatedCents;
  return visiveis.value.filter((a) => a.type !== "credit_card").reduce((s, a) => s + saldoDe(a), 0);
});
const temCartao = computed(() => visiveis.value.some((a) => a.type === "credit_card"));
const cartoesVisivel = computed(() => {
  if (filtro.value === "all" && store.balances) return store.balances.cardsCents;
  return visiveis.value.filter((a) => a.type === "credit_card").reduce((s, a) => s + saldoDe(a), 0);
});

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
  conciliarId.value = null;
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

const conciliarConta = computed(() => store.accounts.find((a) => a.id === conciliarId.value) ?? null);
const saldoRealCents = computed(() => parseMoneyInput(saldoReal.value));
// saldo que o sistema mostra, só se já veio do servidor (nunca cai no saldo inicial: o ajuste sairia errado)
const saldoAtual = computed(() => store.balances?.accounts.find((b) => b.accountId === conciliarId.value)?.balanceCents ?? null);
const semSaldo = computed(() => conciliarConta.value !== null && saldoAtual.value === null);
// ajuste previsto no saldo inicial: saldo real informado - saldo que o sistema mostra hoje
const ajusteCents = computed(() => (saldoRealCents.value === null || saldoAtual.value === null ? null : saldoRealCents.value - saldoAtual.value));
const cartaoPositivo = computed(() => conciliarConta.value?.type === "credit_card" && (saldoRealCents.value ?? 0) > 0);
// só com lançamentos já carregados no store (ex.: lista de Transações); sem eles a nota não aparece
const futuros = computed(() => {
  if (!conciliarConta.value || store.transactions.length === 0) return null;
  const f = futureActivity(store.transactions, conciliarConta.value.id, localTodayISO());
  return f.count > 0 ? f : null;
});

function iniciarConciliacao(acc: BankAccount) {
  erro.value = "";
  aviso.value = "";
  editId.value = null;
  conciliarId.value = acc.id;
  saldoReal.value = "";
}

function cancelarConciliacao() {
  conciliarId.value = null;
}

async function conciliar() {
  const acc = conciliarConta.value;
  const alvo = saldoRealCents.value;
  if (!acc || alvo === null || semSaldo.value || conciliando.value) return;
  erro.value = "";
  conciliando.value = true;
  try {
    const r = await store.reconcileAccount(acc.id, alvo);
    conciliarId.value = null;
    aviso.value = `Saldo conciliado: ${formatBRL(r.newBalanceCents)} (${acc.name}; ajuste de saldo inicial: ${formatAdjustment(r.adjustmentCents)})`;
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    conciliando.value = false;
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
        :aria-pressed="filtro === f.value"
        @click="filtro = f.value"
      >{{ f.label }}</button>
    </div>

    <div class="consolidated" v-if="store.balances">
      <div>Saldo em contas{{ filtro === 'all' ? '' : ' ' + filtro.toUpperCase() }}: <strong><Money :cents="saldoVisivel" /></strong></div>
      <div v-if="temCartao" class="cards-owed">Cartões a pagar: <strong><Money :cents="cartoesVisivel" /></strong></div>
    </div>

    <p v-if="aviso" role="status" class="notice">{{ aviso }}</p>
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
        <template v-else-if="conciliarId === acc.id">
          <form class="reconcile-form" @submit.prevent="conciliar">
            <h3>Conciliar saldo: {{ acc.name }}</h3>
            <p v-if="saldoAtual !== null" class="reconcile-current">Saldo no sistema: <strong><Money :cents="saldoAtual" /></strong></p>
            <p v-else class="text-error" role="alert">Os saldos ainda não foram carregados. Recarregue a página para conciliar.</p>
            <p v-if="futuros" class="hint" data-test="reconcile-future">
              Há {{ futuros.count }} {{ futuros.count === 1 ? "lançamento" : "lançamentos" }} com data futura (total {{ formatBRL(futuros.netCents) }}); eles entram no saldo de hoje.
            </p>
            <label :for="`reconcile-${acc.id}`">Saldo real hoje (R$)</label>
            <input
              :id="`reconcile-${acc.id}`"
              v-model="saldoReal"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              placeholder="Ex.: 6.508,80"
              :disabled="semSaldo"
            />
            <p class="hint">
              Informe o saldo que o banco mostra agora. O sistema ajusta o saldo inicial da conta pela diferença.
              <template v-if="acc.type === 'credit_card'"> Informe o total devido hoje (fatura aberta + parcelas), como valor negativo.</template>
            </p>
            <div aria-live="polite">
              <template v-if="ajusteCents !== null && saldoRealCents !== null">
                <p class="reconcile-informed" data-test="reconcile-informed">Saldo informado: <strong>{{ formatBRL(saldoRealCents) }}</strong></p>
                <p class="reconcile-preview" data-test="reconcile-preview">
                  Ajuste de saldo inicial: <strong>{{ formatAdjustment(ajusteCents) }}</strong>
                </p>
                <p v-if="cartaoPositivo" class="warn" data-test="reconcile-card-warning">
                  Atenção: em cartão, o valor devido é negativo. Confirme que o saldo positivo informado é mesmo o que você quer.
                </p>
              </template>
              <p v-else-if="saldoReal.trim() && saldoRealCents === null" class="text-error" role="alert">Valor inválido. Use o formato 1.234,56 (sinal de menos para valores negativos).</p>
            </div>
            <div class="edit-actions">
              <button type="submit" :disabled="saldoRealCents === null || semSaldo || conciliando">Confirmar conciliação</button>
              <button type="button" class="btn-secondary btn-small" @click="cancelarConciliacao">Cancelar</button>
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
            <button v-if="!acc.archived" type="button" class="btn-secondary btn-small" @click="iniciarConciliacao(acc)">Conciliar saldo</button>
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
.cards-owed { font-size: 0.95rem; color: var(--text-muted); }
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
.reconcile-form { display: flex; flex-direction: column; gap: var(--space); width: 100%; }
.reconcile-form h3 { margin-bottom: 0; font-size: 1rem; }
.reconcile-form input { width: 100%; }
.reconcile-current, .reconcile-preview, .reconcile-informed { margin: 0; }
.warn { margin: 0; font-size: 0.85rem; color: var(--warning); }
.hint { font-size: 0.85rem; color: var(--text-muted); margin: 0; }
.notice { font-size: 0.9rem; margin: 0 0 calc(var(--space) * 2); color: var(--c-income); }
p[role="alert"] { font-size: 0.9rem; margin-top: calc(var(--space) * 2); }
</style>
