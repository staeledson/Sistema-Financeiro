<script setup lang="ts">
import { ACCOUNT_TYPE_LABEL, ENTITY_LABEL, INSTITUTION_LABEL } from "../lib/entity";
import type { AccountFormState } from "../lib/account-form";

defineProps<{ showOpeningBalance?: boolean; lockType?: boolean }>();
const form = defineModel<AccountFormState>({ required: true });
</script>

<template>
  <div class="account-fields">
    <input v-model="form.name" placeholder="Nome" />
    <select v-model="form.type" :disabled="lockType" aria-label="Tipo de conta">
      <option v-for="(label, value) in ACCOUNT_TYPE_LABEL" :key="value" :value="value">{{ label }}</option>
    </select>
    <select v-model="form.entity" aria-label="Entidade">
      <option v-for="(label, value) in ENTITY_LABEL" :key="value" :value="value">{{ label }}</option>
    </select>
    <select v-model="form.institution" aria-label="Instituição">
      <option v-for="(label, value) in INSTITUTION_LABEL" :key="value" :value="value">{{ label }}</option>
    </select>
    <input v-model="form.externalId" placeholder="Nº da conta ou final do cartão (opcional)" />
    <input
      v-if="showOpeningBalance"
      v-model.number="form.openingBalanceReais"
      type="number"
      step="0.01"
      placeholder="Saldo inicial (R$)"
    />
    <template v-if="form.type === 'credit_card'">
      <input v-model.number="form.closingDay" type="number" min="1" max="31" placeholder="Dia de fechamento (1–31)" />
      <input v-model.number="form.dueDay" type="number" min="1" max="31" placeholder="Dia de vencimento (1–31)" />
      <input v-model.number="form.creditLimitReais" type="number" min="0" step="0.01" placeholder="Limite (R$)" />
    </template>
  </div>
</template>

<style scoped>
.account-fields { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
input, select { padding: calc(var(--space) * 1.5); border: 1px solid #333; border-radius: calc(var(--radius) / 2); background: var(--color-bg); color: var(--color-text); font-size: 1rem; }
</style>
