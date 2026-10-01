<script setup lang="ts">
import EmptyState from "./EmptyState.vue";

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  class?: string;
}

defineProps<{
  columns: DataTableColumn[];
  rows: Array<Record<string, unknown>>;
  emptyTitle?: string;
  emptyHint?: string;
}>();
</script>

<template>
  <div class="table-wrap">
    <table v-if="rows.length" class="data-table">
      <thead>
        <tr>
          <th v-for="c in columns" :key="c.key" :class="[c.class, c.align && `a-${c.align}`]">{{ c.label }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in rows" :key="(row.id as string | number | undefined) ?? i">
          <td v-for="c in columns" :key="c.key" :class="[c.class, c.align && `a-${c.align}`]">
            <slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]">{{ row[c.key] }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
    <EmptyState v-else :title="emptyTitle ?? 'Nada por aqui'" :hint="emptyHint" />
  </div>
</template>

<style scoped>
.table-wrap { overflow-x: auto; }
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
