<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useAuthStore } from "../stores/auth";
import { useFinanceStore } from "../stores/finance";

const auth = useAuthStore();
const finance = useFinanceStore();
const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

type Format = "csv" | "ofx" | "pdf";
type Step = "format" | "upload" | "preview" | "done";

const step = ref<Step>("format");
const format = ref<Format>("csv");
const selectedAccountId = ref("");
const erro = ref("");
const status = ref("");

// CSV fields
const csvText = ref("");
const savedMappings = ref<Array<{ id: string; name: string; mapping: unknown }>>([]);
const selectedMappingId = ref("");
const mapping = ref({
  dateColumn: "",
  amountColumn: "",
  descriptionColumn: "",
  dateFormat: "DD/MM/YYYY" as "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY",
  decimalSeparator: "," as "," | ".",
  expenseIsNegative: true,
});
const csvHeaders = ref<string[]>([]);
const mappingName = ref("");

// OFX fields
const ofxText = ref("");

// PDF fields
const pdfFile = ref<File | null>(null);

// Preview
const previewRows = ref<Array<{ type: string; amountCents: number; date: string; description: string | null; fingerprint: string; dup: boolean; selected: boolean }>>([]);
const batchId = ref("");

onMounted(() => finance.loadAccounts());

async function apiReq(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${auth.token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function onFormatChosen() {
  step.value = "upload";
  if (format.value === "csv") loadMappings();
}

async function loadMappings() {
  try {
    const list = await apiReq("GET", "/import/mappings");
    savedMappings.value = list.filter((m: { format: string }) => m.format === "csv");
  } catch { /* ignore */ }
}

function onCsvInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    csvText.value = ev.target?.result as string;
    const firstLine = csvText.value.split("\n")[0] ?? "";
    csvHeaders.value = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    // Heuristic: auto-detect columns
    const headers = csvHeaders.value;
    mapping.value.dateColumn = headers.find((h) => /data|date|dt/i.test(h)) ?? headers[0] ?? "";
    mapping.value.amountColumn = headers.find((h) => /valor|amount|value|credit|debit/i.test(h)) ?? headers[1] ?? "";
    mapping.value.descriptionColumn = headers.find((h) => /hist|desc|memo|lancamento|name/i.test(h)) ?? "";
  };
  reader.readAsText(file);
}

function onOfxInput(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => { ofxText.value = ev.target?.result as string; };
  reader.readAsText(file);
}

function applyMapping(m: { id: string; name: string; mapping: unknown }) {
  selectedMappingId.value = m.id;
  Object.assign(mapping.value, m.mapping);
}

async function preview() {
  erro.value = "";
  if (!selectedAccountId.value) { erro.value = "Selecione uma conta."; return; }
  status.value = "Analisando...";
  try {
    let data: { batchId: string; rows: typeof previewRows.value; rowCount: number; dupCount: number };
    if (format.value === "csv") {
      data = await apiReq("POST", "/import/csv/preview", {
        accountId: selectedAccountId.value,
        mapping: mapping.value,
        csv: csvText.value,
      });
    } else {
      data = await apiReq("POST", "/import/ofx/preview", {
        accountId: selectedAccountId.value,
        ofx: ofxText.value,
      });
    }
    batchId.value = data.batchId;
    previewRows.value = data.rows.map((r) => ({ ...r, selected: !r.dup }));
    step.value = "preview";
    status.value = "";
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  }
}

async function commit() {
  erro.value = "";
  status.value = "Importando...";
  try {
    const rows = previewRows.value.filter((r) => r.selected);
    const result = await apiReq("POST", `/import/${batchId.value}/commit`, {
      rows: rows.map(({ type, amountCents, date, fingerprint, description }) => ({
        type, amountCents, date, fingerprint, description, accountId: selectedAccountId.value,
      })),
    });
    status.value = `${result.inserted} transações importadas!`;
    step.value = "done";
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  }
}

async function enqueuePdf() {
  if (!pdfFile.value) return;
  erro.value = "";
  status.value = "Enviando PDF...";
  try {
    const { url, storagePath } = await apiReq("POST", "/ingest/upload-url", {
      ext: "pdf",
      contentType: "application/pdf",
    });
    await fetch(url, { method: "PUT", body: pdfFile.value, headers: { "content-type": "application/pdf" } });
    const { jobId } = await apiReq("POST", "/import/pdf", { storagePath });
    status.value = `PDF enviado para análise! Job: ${jobId}. Os lançamentos aparecerão em "Revisar".`;
    step.value = "done";
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  }
}

async function saveMapping() {
  if (!mappingName.value.trim()) return;
  try {
    await apiReq("POST", "/import/mappings", { name: mappingName.value.trim(), format: "csv", mapping: mapping.value });
    mappingName.value = "";
    await loadMappings();
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

const selectedCount = computed(() => previewRows.value.filter((r) => r.selected).length);

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function reset() {
  step.value = "format";
  csvText.value = "";
  ofxText.value = "";
  pdfFile.value = null;
  previewRows.value = [];
  batchId.value = "";
  selectedAccountId.value = "";
  erro.value = "";
  status.value = "";
}
</script>

<template>
  <section class="import">
    <h2>Importar extrato</h2>

    <p v-if="erro" role="alert" class="error">{{ erro }}</p>
    <p v-if="status" class="status">{{ status }}</p>

    <!-- Step 1: format -->
    <div v-if="step === 'format'" class="card">
      <h3>Formato</h3>
      <div class="radio-group">
        <label><input type="radio" v-model="format" value="csv" /> CSV (extrato bancário)</label>
        <label><input type="radio" v-model="format" value="ofx" /> OFX (padrão bancário)</label>
        <label><input type="radio" v-model="format" value="pdf" /> Fatura PDF (via IA)</label>
      </div>
      <button @click="onFormatChosen">Continuar</button>
    </div>

    <!-- Step 2: upload -->
    <div v-if="step === 'upload'" class="card">
      <!-- Account selector (CSV + OFX) -->
      <template v-if="format !== 'pdf'">
        <h3>Arquivo + mapeamento</h3>
        <label class="field-label">Conta</label>
        <select v-model="selectedAccountId">
          <option value="">— Selecione uma conta —</option>
          <option v-for="a in finance.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
      </template>

      <!-- CSV -->
      <template v-if="format === 'csv'">
        <label class="field-label">Arquivo CSV</label>
        <input type="file" accept=".csv,text/csv" @change="onCsvInput" />

        <template v-if="csvHeaders.length">
          <label class="field-label">Mapeamento de colunas</label>

          <div v-if="savedMappings.length" class="mapping-saved">
            <span>Usar salvo:</span>
            <button
              v-for="m in savedMappings" :key="m.id"
              :class="['btn-small', { active: selectedMappingId === m.id }]"
              @click="applyMapping(m)"
            >{{ m.name }}</button>
          </div>

          <div class="mapping-grid">
            <label>Coluna data</label>
            <select v-model="mapping.dateColumn">
              <option v-for="h in csvHeaders" :key="h" :value="h">{{ h }}</option>
            </select>
            <label>Coluna valor</label>
            <select v-model="mapping.amountColumn">
              <option v-for="h in csvHeaders" :key="h" :value="h">{{ h }}</option>
            </select>
            <label>Coluna descrição</label>
            <select v-model="mapping.descriptionColumn">
              <option value="">— nenhuma —</option>
              <option v-for="h in csvHeaders" :key="h" :value="h">{{ h }}</option>
            </select>
            <label>Formato data</label>
            <select v-model="mapping.dateFormat">
              <option value="DD/MM/YYYY">DD/MM/AAAA</option>
              <option value="YYYY-MM-DD">AAAA-MM-DD</option>
              <option value="MM/DD/YYYY">MM/DD/AAAA</option>
            </select>
            <label>Separador decimal</label>
            <select v-model="mapping.decimalSeparator">
              <option value=",">, (vírgula)</option>
              <option value=".">. (ponto)</option>
            </select>
            <label>Despesas</label>
            <select v-model="mapping.expenseIsNegative">
              <option :value="true">Valores negativos</option>
              <option :value="false">Valores positivos</option>
            </select>
          </div>

          <div class="save-mapping">
            <input v-model="mappingName" placeholder="Nome do mapeamento (ex: Bradesco)" />
            <button class="btn-small" @click="saveMapping" :disabled="!mappingName.trim()">Salvar mapeamento</button>
          </div>
        </template>
      </template>

      <!-- OFX -->
      <template v-else-if="format === 'ofx'">
        <label class="field-label">Arquivo OFX</label>
        <input type="file" accept=".ofx,.qfx" @change="onOfxInput" />
      </template>

      <!-- PDF -->
      <template v-else>
        <h3>Fatura PDF</h3>
        <p class="hint">A IA irá extrair os lançamentos. Eles aparecerão em "Revisar" para confirmação.</p>
        <input type="file" accept=".pdf,application/pdf" @change="(e) => pdfFile = (e.target as HTMLInputElement).files?.[0] ?? null" />
        <button @click="enqueuePdf" :disabled="!pdfFile">Enviar para análise</button>
      </template>

      <div class="btn-row" v-if="format !== 'pdf'">
        <button class="btn-secondary" @click="step = 'format'">Voltar</button>
        <button @click="preview" :disabled="!selectedAccountId || (format === 'csv' && !csvText) || (format === 'ofx' && !ofxText)">
          Ver preview
        </button>
      </div>
    </div>

    <!-- Step 3: preview -->
    <div v-if="step === 'preview'" class="card">
      <h3>Preview ({{ selectedCount }} de {{ previewRows.length }} selecionados)</h3>
      <p class="hint" v-if="previewRows.some(r => r.dup)">Linhas marcadas com ⚠ já existem e estão desmarcadas por padrão.</p>

      <div class="preview-controls">
        <button class="btn-small" @click="previewRows.forEach(r => !r.dup && (r.selected = true))">Selecionar novos</button>
        <button class="btn-small" @click="previewRows.forEach(r => r.selected = !r.dup)">Reset seleção</button>
      </div>

      <div class="preview-table">
        <div class="preview-row header">
          <span></span><span>Data</span><span>Tipo</span><span>Valor</span><span>Descrição</span>
        </div>
        <div
          v-for="(row, i) in previewRows" :key="i"
          :class="['preview-row', { dup: row.dup, selected: row.selected }]"
          @click="row.selected = !row.selected"
        >
          <input type="checkbox" v-model="row.selected" @click.stop />
          <span>{{ row.date }}</span>
          <span :class="row.type">{{ row.type }}</span>
          <span>{{ formatBRL(row.amountCents) }}</span>
          <span class="desc">{{ row.description ?? '—' }} {{ row.dup ? '⚠' : '' }}</span>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn-secondary" @click="step = 'upload'">Voltar</button>
        <button @click="commit" :disabled="selectedCount === 0">
          Importar {{ selectedCount }} lançamento{{ selectedCount !== 1 ? 's' : '' }}
        </button>
      </div>
    </div>

    <!-- Step 4: done -->
    <div v-if="step === 'done'" class="card">
      <h3>Concluído</h3>
      <p>{{ status }}</p>
      <button @click="reset">Nova importação</button>
    </div>
  </section>
</template>

<style scoped>
.import { padding: calc(var(--space) * 3); max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
h2 { margin-bottom: 0; }
.card { background: var(--color-surface); padding: calc(var(--space) * 3); border-radius: var(--radius); display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
h3 { margin: 0; font-size: 1rem; }
.radio-group { display: flex; flex-direction: column; gap: calc(var(--space)); }
label { cursor: pointer; }
.field-label { font-size: 0.85rem; opacity: 0.7; margin-bottom: -8px; }
select, input[type="text"], input[type="file"] {
  background: var(--color-bg); color: var(--color-text);
  border: 1px solid #333; border-radius: calc(var(--radius)/2);
  padding: calc(var(--space)*1.2); font-size: 0.9rem; width: 100%;
}
.mapping-saved { display: flex; align-items: center; gap: var(--space); flex-wrap: wrap; font-size: 0.85rem; opacity: 0.7; }
.mapping-grid { display: grid; grid-template-columns: 1fr 2fr; gap: calc(var(--space)) calc(var(--space)*2); align-items: center; font-size: 0.9rem; }
.save-mapping { display: flex; gap: var(--space); align-items: center; }
.save-mapping input { flex: 1; }
.hint { font-size: 0.85rem; opacity: 0.65; font-style: italic; }
.btn-row { display: flex; gap: var(--space); justify-content: flex-end; }
button { padding: calc(var(--space)*1.5) calc(var(--space)*2); border: none; border-radius: calc(var(--radius)/2); background: var(--color-primary); color: #fff; cursor: pointer; font-size: 0.9rem; }
button:disabled { opacity: 0.4; cursor: default; }
.btn-secondary { background: #444; }
.btn-small { padding: calc(var(--space)) calc(var(--space)*1.5); font-size: 0.8rem; background: #333; }
.btn-small.active { background: var(--color-primary); }
.preview-controls { display: flex; gap: var(--space); }
.preview-table { border: 1px solid #333; border-radius: calc(var(--radius)/2); overflow: hidden; }
.preview-row { display: grid; grid-template-columns: 28px 100px 80px 110px 1fr; gap: var(--space); padding: calc(var(--space)*1.2) calc(var(--space)*2); align-items: center; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid #222; }
.preview-row:last-child { border-bottom: none; }
.preview-row.header { font-weight: 600; opacity: 0.6; cursor: default; background: #1a1a1a; }
.preview-row:hover:not(.header) { background: rgba(79,124,255,.07); }
.preview-row.selected { background: rgba(79,124,255,.12); }
.preview-row.dup { opacity: 0.5; }
.income { color: #2ecc71; }
.expense { color: #e74c3c; }
.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.error { color: #e74c3c; font-size: 0.9rem; }
.status { font-size: 0.9rem; opacity: 0.8; }
</style>
