<script setup lang="ts" generic="T extends object">
import EmptyState from "./EmptyState.vue";

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  class?: string;
}

defineProps<{
  columns: DataTableColumn[];
  rows: T[];
  /** Legenda visível só para leitores de tela. */
  caption?: string;
  ariaLabel?: string;
  emptyTitle?: string;
  emptyHint?: string;
}>();

function cellValue(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function rowKey(row: T, i: number): string | number {
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : i;
}
</script>

<template>
  <div class="table-wrap">
    <table v-if="rows.length" class="data-table" :aria-label="ariaLabel">
      <caption v-if="caption" class="sr-only">{{ caption }}</caption>
      <thead>
        <tr>
          <th v-for="c in columns" :key="c.key" scope="col" :class="[c.class, c.align && `a-${c.align}`]">{{ c.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="rowKey(row, i)">
          <td v-for="c in columns" :key="c.key" :class="[c.class, c.align && `a-${c.align}`]">
            <slot :name="`cell-${c.key}`" :row="row" :value="cellValue(row, c.key)">{{ cellValue(row, c.key) }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-else :title="emptyTitle ?? 'Nada por aqui'" :hint="emptyHint" />
  </div>
</template>

<style scoped>
.table-wrap { overflow-x: auto; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
th {
  text-align: left;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
  padding: var(--space) calc(var(--space) * 1.5);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
td { padding: calc(var(--space) * 1.1) calc(var(--space) * 1.5); border-bottom: 1px solid var(--border); }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--surface-2); }
.a-right { text-align: right; font-variant-numeric: tabular-nums; }
.a-center { text-align: center; }
</style>
