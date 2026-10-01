<template>
  <div class="filter-bar"><slot /></div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space) calc(var(--space) * 1.5);
  padding: var(--space) calc(var(--space) * 1.5);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
</style>
