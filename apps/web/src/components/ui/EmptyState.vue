<script setup lang="ts">
defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <div class="empty-state">
    <p class="title">{{ title }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  text-align: center;
  padding: calc(var(--space) * 4) calc(var(--space) * 2);
  color: var(--text-muted);
}
.title { color: var(--text); font-weight: 600; }
.hint { margin-top: calc(var(--space) * 0.5); font-size: 0.9rem; }
</style>
