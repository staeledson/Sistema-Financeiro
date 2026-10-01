<script setup lang="ts">
import { RouterLink, type RouteLocationRaw } from "vue-router";

defineProps<{ title?: string; value?: string; insight?: string; to?: RouteLocationRaw }>();
</script>

<template>
  <component :is="to ? RouterLink : 'section'" :to="to" class="card" :class="{ link: !!to }">
    <header v-if="title || $slots.actions" class="card-head">
      <h3 v-if="title" class="card-title">{{ title }}</h3>
      <div v-if="$slots.actions" class="card-actions"><slot name="actions" /></div>
    </header>
    <p v-if="value" class="card-value">{{ value }}</p>
    <p v-if="insight" class="card-insight">{{ insight }}</p>
    <div v-if="$slots.default" class="card-body"><slot /></div>
  </component>
</template>

<style scoped>
.card {
  display: block;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: calc(var(--space) * 2);
  color: var(--text);
  text-decoration: none;
}
.card.link:hover { border-color: var(--accent); }
.card-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space); margin-bottom: var(--space); }
.card-title { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
.card-actions { display: flex; gap: var(--space); align-items: center; }
.card-value { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-size: 1.6rem; font-weight: 700; }
.card-insight { margin-top: calc(var(--space) * 0.5); font-size: 0.85rem; color: var(--text-muted); }
.card-body { margin-top: var(--space); }
</style>
