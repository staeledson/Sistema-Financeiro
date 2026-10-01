<script setup lang="ts">
import { ENTITY_SHORT, ENTITY_LABEL, type AccountEntity } from "../../lib/entity";

defineProps<{ entity: AccountEntity }>();
</script>

<template>
  <span class="entity-badge" :class="entity" :title="ENTITY_LABEL[entity]">{{ ENTITY_SHORT[entity] }}</span>
</template>

<style scoped>
.entity-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.5;
  letter-spacing: 0.03em;
}
.pf { color: var(--c-pf); background: color-mix(in srgb, var(--c-pf) 15%, transparent); }
.pj { color: var(--c-pj); background: color-mix(in srgb, var(--c-pj) 15%, transparent); }
</style>
