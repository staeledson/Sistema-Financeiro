<script setup lang="ts">
import RulesPanel from "../components/RulesPanel.vue";
</script>

<template>
  <section class="regras-view">
    <RulesPanel />
  </section>
</template>

<style scoped>
.regras-view { padding: calc(var(--space) * 3); max-width: 960px; }
</style>
