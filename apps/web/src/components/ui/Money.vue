<script setup lang="ts">
import { computed } from "vue";
import { formatBRL, formatBRLCompact, signedClass } from "../../lib/money";

const props = defineProps<{ cents: number; colored?: boolean; compact?: boolean }>();

const text = computed(() => (props.compact ? formatBRLCompact(props.cents) : formatBRL(props.cents)));
const cls = computed(() => (props.colored ? signedClass(props.cents) : undefined));
</script>

<template>
  <span class="money" :class="cls">{{ text }}</span>
</template>

<style scoped>
.money { font-family: var(--font-num); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pos { color: var(--c-income); }
.neg { color: var(--c-expense); }
.zero { color: var(--text-muted); }
</style>
