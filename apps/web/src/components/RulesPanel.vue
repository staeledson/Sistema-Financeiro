<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useFinanceStore } from "../stores/finance";
import { deleteRule, listRules, type RuleRow } from "../lib/review-client";

const finance = useFinanceStore();
const rules = ref<RuleRow[]>([]);
const erro = ref("");
const busy = ref(false);
const loaded = ref(false);

const MATCH_LABEL: Record<RuleRow["matchType"], string> = { contains: "contém", equals: "igual a", regex: "regex" };

let loadSeq = 0;

async function load() {
  const seq = ++loadSeq;
  erro.value = "";
  try {
    const res = await listRules();
    if (seq !== loadSeq) return;
    rules.value = res;
    loaded.value = true;
  } catch (e) {
    if (seq !== loadSeq) return;
    erro.value = (e as Error).message;
  }
}

// O pai recarrega a lista depois de criar uma regra com o painel aberto.
defineExpose({ reload: load });

onMounted(async () => {
  // O pai já carrega as categorias; só busca aqui se o painel for montado sem elas.
  const cats = finance.categories.length ? Promise.resolve() : finance.loadCategories().catch((e) => { erro.value = (e as Error).message; });
  await Promise.all([cats, load()]);
});

function categoryName(id: string) {
  return finance.categories.find((c) => c.id === id)?.name ?? "—";
}

async function remove(id: string) {
  if (busy.value) return;
  if (!window.confirm("Excluir esta regra?")) return;
  busy.value = true;
  try {
    await deleteRule(id);
    await load();
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="rules">
    <h3>Regras de categorização</h3>
    <p v-if="erro" role="alert" class="text-error">{{ erro }}</p>
    <p v-if="loaded && !rules.length" class="hint">Nenhuma regra ainda. Elas nascem quando você categoriza um grupo.</p>
    <table v-else-if="rules.length" class="rules-table">
      <thead>
        <tr><th>Padrão</th><th>Casamento</th><th>Categoria</th><th>Prioridade</th><th>Acertos</th><th></th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rules" :key="r.id">
          <td>{{ r.pattern }}</td>
          <td>{{ MATCH_LABEL[r.matchType] }}</td>
          <td>{{ categoryName(r.categoryId) }}</td>
          <td>{{ r.priority }}</td>
          <td>{{ r.hitCount }}</td>
          <td><button type="button" class="btn-danger btn-small" :disabled="busy" @click="remove(r.id)">Excluir</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rules { display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
h3 { margin: 0; font-size: 1rem; }
.hint { font-size: 0.85rem; color: var(--text-muted); font-style: italic; }
.text-error { font-size: 0.9rem; }
.rules-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.rules-table th, .rules-table td { text-align: left; padding: var(--space); border-bottom: 1px solid var(--border); }
.rules-table th { color: var(--text-muted); font-weight: 600; }
</style>
