<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, type WorkspaceSettings } from "../lib/api";
import {
  formatOwnerNames, parseOwnerNames, SETTINGS_LIMITS, validateSettingsForm, type SettingsErrors,
} from "../lib/settings-client";
import { useSection } from "../lib/use-section";
import { useThemeStore, type ThemeMode } from "../stores/theme";
import { useWorkspaceStore } from "../stores/workspace";
import Card from "../components/ui/Card.vue";

const theme = useThemeStore();
const workspace = useWorkspaceStore();

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Escuro" },
];

const settings = useSection(() => api.settings.get());

// Campos do formulário (número vem como `number | ""` do input; vazio vira NaN na validação).
const ownerText = ref("");
const threshold = ref<number | "">(0.8);
const batchSize = ref<number | "">(40);
const windowDays = ref<number | "">(2);

const errors = ref<SettingsErrors>({});
const saving = ref(false);
const saveError = ref("");
const saved = ref(false);

function fill(s: WorkspaceSettings) {
  ownerText.value = formatOwnerNames(s.ownerNames);
  threshold.value = s.aiConfidenceThreshold;
  batchSize.value = s.aiBatchSize;
  windowDays.value = s.transferMatchWindowDays;
}

async function load() {
  await settings.run();
  if (settings.data.value) fill(settings.data.value);
}

onMounted(load);
watch(() => workspace.activeId, () => {
  errors.value = {};
  saveError.value = "";
  saved.value = false;
  void load();
});

const num = (v: number | "") => (v === "" ? Number.NaN : v);
const ownerCount = computed(() => parseOwnerNames(ownerText.value, Infinity).length);

async function save() {
  saved.value = false;
  saveError.value = "";
  const result = validateSettingsForm({
    aiConfidenceThreshold: num(threshold.value),
    aiBatchSize: num(batchSize.value),
    transferMatchWindowDays: num(windowDays.value),
    ownerNames: parseOwnerNames(ownerText.value, Infinity),
  });
  if (!result.ok) {
    errors.value = result.errors;
    return;
  }
  errors.value = {};
  saving.value = true;
  try {
    const updated = await api.settings.update(result.value);
    settings.data.value = updated;
    fill(updated);
    saved.value = true;
  } catch (e) {
    saveError.value = e instanceof Error && e.message ? e.message : "Não foi possível salvar.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="ajustes">
    <h2>Ajustes</h2>

    <Card title="Aparência">
      <fieldset class="theme">
        <legend>Tema</legend>
        <label v-for="t in THEMES" :key="t.value" class="radio">
          <input type="radio" name="tema" :value="t.value" :checked="theme.mode === t.value" @change="theme.setMode(t.value)" />
          {{ t.label }}
        </label>
      </fieldset>
      <p class="hint">"Sistema" acompanha o tema do seu aparelho. A escolha vale só neste navegador.</p>
    </Card>

    <Card title="Importação e categorização">
      <div v-if="settings.error.value" class="state" role="alert">
        <p>{{ settings.error.value }}</p>
        <button type="button" @click="load">Tentar de novo</button>
      </div>
      <p v-else-if="!settings.data.value" class="state" role="status">Carregando…</p>

      <form v-else class="form" novalidate @submit.prevent="save">
        <div class="field">
          <label for="owner-names">Nomes do titular e da empresa</label>
          <textarea
            id="owner-names"
            v-model="ownerText"
            rows="4"
            placeholder="Um por linha ou separados por vírgula"
            :aria-invalid="!!errors.ownerNames"
            aria-describedby="owner-help owner-err"
          />
          <p id="owner-help" class="hint">
            Escreva o seu nome e o da sua empresa como aparecem nos extratos. Sem eles, o Pix entre as suas contas não é
            pareado e entra como receita e despesa. Até {{ SETTINGS_LIMITS.maxOwnerNames }} nomes ({{ ownerCount }} informados).
          </p>
          <p v-if="errors.ownerNames" id="owner-err" class="err" role="alert">{{ errors.ownerNames }}</p>
        </div>

        <div class="field">
          <label for="threshold">Confiança mínima da IA (0 a 1)</label>
          <input
            id="threshold"
            v-model.number="threshold"
            type="number"
            step="0.05"
            :min="SETTINGS_LIMITS.threshold.min"
            :max="SETTINGS_LIMITS.threshold.max"
            :aria-invalid="!!errors.aiConfidenceThreshold"
            aria-describedby="threshold-help threshold-err"
          />
          <p id="threshold-help" class="hint">Abaixo disso o lançamento vai para Para categorizar.</p>
          <p v-if="errors.aiConfidenceThreshold" id="threshold-err" class="err" role="alert">{{ errors.aiConfidenceThreshold }}</p>
        </div>

        <div class="field">
          <label for="batch">Tamanho do lote da IA (1 a 200)</label>
          <input
            id="batch"
            v-model.number="batchSize"
            type="number"
            step="1"
            :min="SETTINGS_LIMITS.batchSize.min"
            :max="SETTINGS_LIMITS.batchSize.max"
            :aria-invalid="!!errors.aiBatchSize"
            aria-describedby="batch-help batch-err"
          />
          <p id="batch-help" class="hint">Quantos lançamentos vão juntos em cada chamada à IA.</p>
          <p v-if="errors.aiBatchSize" id="batch-err" class="err" role="alert">{{ errors.aiBatchSize }}</p>
        </div>

        <div class="field">
          <label for="window">Janela de pareamento de transferências, em dias (0 a 10)</label>
          <input
            id="window"
            v-model.number="windowDays"
            type="number"
            step="1"
            :min="SETTINGS_LIMITS.windowDays.min"
            :max="SETTINGS_LIMITS.windowDays.max"
            :aria-invalid="!!errors.transferMatchWindowDays"
            aria-describedby="window-help window-err"
          />
          <p id="window-help" class="hint">Diferença máxima entre as datas da saída e da entrada para formarem um par.</p>
          <p v-if="errors.transferMatchWindowDays" id="window-err" class="err" role="alert">{{ errors.transferMatchWindowDays }}</p>
        </div>

        <div class="actions">
          <button type="submit" :disabled="saving">{{ saving ? "Salvando…" : "Salvar" }}</button>
          <p v-if="saved" class="ok" role="status">Ajustes salvos.</p>
          <p v-if="saveError" class="err" role="alert">{{ saveError }}</p>
        </div>
        <p class="hint">Só o dono e os administradores do workspace alteram estes ajustes.</p>
      </form>
    </Card>
  </section>
</template>

<style scoped>
.ajustes { padding: calc(var(--space) * 3); max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
.theme { border: 0; padding: 0; margin: 0; display: flex; gap: calc(var(--space) * 3); flex-wrap: wrap; }
.theme legend { font-size: 0.85rem; color: var(--text-muted); margin-bottom: var(--space); }
.radio { display: inline-flex; align-items: center; gap: var(--space); cursor: pointer; }
.form { display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
.field { display: flex; flex-direction: column; gap: calc(var(--space) * 0.75); }
.field label { font-weight: 600; font-size: 0.9rem; }
.field input[type="number"] { max-width: 160px; }
.hint { font-size: 0.82rem; color: var(--text-muted); }
.err { font-size: 0.85rem; color: var(--danger); }
.ok { font-size: 0.85rem; color: var(--c-income); }
.actions { display: flex; align-items: center; gap: calc(var(--space) * 2); flex-wrap: wrap; }
.state { color: var(--text-muted); }
.state button { margin-top: var(--space); }

@media (max-width: 768px) {
  .ajustes { padding: calc(var(--space) * 2); }
}
</style>
