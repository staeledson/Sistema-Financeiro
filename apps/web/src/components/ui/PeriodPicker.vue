<script setup lang="ts">
import { computed, ref, watch } from "vue";

export interface PeriodValue {
  month?: string;
  quarter?: string;
  year?: string;
  from?: string;
  to?: string;
}
type Kind = "month" | "quarter" | "year" | "range";

const props = defineProps<{ modelValue?: PeriodValue }>();
const emit = defineEmits<{ "update:modelValue": [value: PeriodValue] }>();

const TABS: Array<{ kind: Kind; label: string }> = [
  { kind: "month", label: "Mês" },
  { kind: "quarter", label: "Trimestre" },
  { kind: "year", label: "Ano" },
  { kind: "range", label: "Intervalo" },
];

function kindOf(v?: PeriodValue): Kind {
  if (v?.from || v?.to) return "range";
  if (v?.year) return "year";
  if (v?.quarter) return "quarter";
  return "month";
}

const now = new Date();
const curYear = String(now.getFullYear());
const curMonth = `${curYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const curQuarter = `${curYear}-Q${Math.floor(now.getMonth() / 3) + 1}`;

const kind = ref<Kind>(kindOf(props.modelValue));
const month = ref(props.modelValue?.month ?? curMonth);
const quarterYear = ref(props.modelValue?.quarter?.slice(0, 4) ?? curYear);
const quarterNo = ref(props.modelValue?.quarter?.slice(-1) ?? curQuarter.slice(-1));
const year = ref(props.modelValue?.year ?? curYear);
const from = ref(props.modelValue?.from ?? "");
const to = ref(props.modelValue?.to ?? "");

watch(
  () => props.modelValue,
  (v) => {
    if (!v) return;
    kind.value = kindOf(v);
    if (v.month) month.value = v.month;
    if (v.quarter) {
      quarterYear.value = v.quarter.slice(0, 4);
      quarterNo.value = v.quarter.slice(-1);
    }
    if (v.year) year.value = v.year;
    if (v.from) from.value = v.from;
    if (v.to) to.value = v.to;
  },
);

const YEAR_RE = /^(19|20)\d{2}$/;
const MONTH_RE = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

const rangeInvalid = computed(() => !!from.value && !!to.value && from.value > to.value);

/** Valor atual da aba ativa, só com a chave dessa aba; `null` se incompleto. */
const current = computed<PeriodValue | null>(() => {
  switch (kind.value) {
    case "month":
      return MONTH_RE.test(month.value) ? { month: month.value } : null;
    case "quarter":
      return YEAR_RE.test(quarterYear.value) ? { quarter: `${quarterYear.value}-Q${quarterNo.value}` } : null;
    case "year":
      return YEAR_RE.test(year.value) ? { year: year.value } : null;
    default:
      return from.value && to.value && !rangeInvalid.value ? { from: from.value, to: to.value } : null;
  }
});

function emitCurrent() {
  if (current.value) emit("update:modelValue", current.value);
}

function selectKind(k: Kind) {
  kind.value = k;
  emitCurrent();
}
</script>

<template>
  <div class="period-picker">
    <div class="tabs" role="tablist" aria-label="Tipo de período">
      <button
        v-for="t in TABS"
        :key="t.kind"
        type="button"
        role="tab"
        class="tab"
        :class="{ active: kind === t.kind }"
        :aria-selected="kind === t.kind"
        @click="selectKind(t.kind)"
      >{{ t.label }}</button>
    </div>

    <div class="inputs">
      <input v-if="kind === 'month'" v-model="month" type="month" aria-label="Mês" @change="emitCurrent" />
      <template v-else-if="kind === 'quarter'">
        <select v-model="quarterNo" aria-label="Trimestre" @change="emitCurrent">
          <option value="1">1º tri</option>
          <option value="2">2º tri</option>
          <option value="3">3º tri</option>
          <option value="4">4º tri</option>
        </select>
        <input v-model="quarterYear" type="text" inputmode="numeric" maxlength="4" aria-label="Ano do trimestre" @change="emitCurrent" />
      </template>
      <input v-else-if="kind === 'year'" v-model="year" type="text" inputmode="numeric" maxlength="4" aria-label="Ano" @change="emitCurrent" />
      <template v-else>
        <input v-model="from" type="date" aria-label="De" @change="emitCurrent" />
        <input v-model="to" type="date" aria-label="Até" @change="emitCurrent" />
      </template>
    </div>
    <p v-if="kind === 'range' && rangeInvalid" class="range-hint" role="alert">A data inicial deve ser anterior à final.</p>
  </div>
</template>

<style scoped>
.period-picker { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--space); }
.tabs { display: inline-flex; background: var(--surface-2); border-radius: calc(var(--radius) / 1.5); padding: 2px; }
.tab {
  background: transparent;
  color: var(--text-muted);
  border-color: transparent;
  padding: calc(var(--space) * 0.6) calc(var(--space) * 1.4);
  font-size: 0.85rem;
}
.tab.active { background: var(--surface); color: var(--text); font-weight: 600; border-color: var(--border); }
.range-hint { flex-basis: 100%; font-size: 0.78rem; color: var(--danger); }
.inputs { display: inline-flex; gap: var(--space); }
.inputs input[inputmode="numeric"] { width: 5rem; }
</style>
