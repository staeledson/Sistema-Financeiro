<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { http } from "../lib/http";
import { useFinanceStore } from "../stores/finance";
import { INSTITUTION_LABEL } from "../lib/entity";
import {
  balanceSummary, detectFile, previewStatement, undoBatch, listBatches, decodeText, readFileBytes, formatDate,
  type BatchSummary, type DetectResponse, type PreviewRow, type StatementPreview,
} from "../lib/import-client";

const finance = useFinanceStore();

type Step = "upload" | "confirm" | "csv" | "ai" | "preview" | "done";
type SelectableRow = PreviewRow & { selected: boolean };

const step = ref<Step>("upload");
const file = ref<File | null>(null);
const detected = ref<DetectResponse | null>(null);
const selectedAccountId = ref("");
const rememberAccount = ref(true);
const erro = ref("");
const status = ref("");
const dragging = ref(false);
const busy = ref(false);

const preview = ref<StatementPreview | null>(null);
const previewRows = ref<SelectableRow[]>([]);
const batchId = ref("");
const batches = ref<BatchSummary[]>([]);

// CSV (mapeamento manual)
const csvText = ref("");
const csvHeaders = ref<string[]>([]);
const savedMappings = ref<Array<{ id: string; name: string; mapping: unknown }>>([]);
const selectedMappingId = ref("");
const mappingName = ref("");
const mapping = ref({
  dateColumn: "",
  amountColumn: "",
  descriptionColumn: "",
  dateFormat: "DD/MM/YYYY" as "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY",
  decimalSeparator: "," as "," | ".",
  expenseIsNegative: true,
});

onMounted(async () => {
  await finance.loadAccounts();
  await loadBatches();
});

const balance = computed(() => balanceSummary(preview.value?.balanceCheck ?? null));
const selectedCount = computed(() => previewRows.value.filter((r) => r.selected).length);
const selectedAccount = computed(() => finance.accounts.find((a) => a.id === selectedAccountId.value));
const canRemember = computed(
  () =>
    !!detected.value?.accountRef &&
    !!selectedAccount.value &&
    !selectedAccount.value.externalId &&
    !finance.accounts.some((a) => a.externalId === detected.value?.accountRef),
);
const kindLabel = computed(() => (detected.value?.kind === "card_invoice" ? "Fatura de cartão" : "Extrato de conta"));
const isStatement = computed(() => detected.value?.format === "ofx" || detected.value?.format === "pdf_statement");

async function loadBatches() {
  try {
    batches.value = await listBatches();
  } catch {
    /* histórico é secundário */
  }
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = "";
  if (f) void handleFile(f);
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) void handleFile(f);
}

async function handleFile(f: File) {
  erro.value = "";
  file.value = f;
  detected.value = null;
  status.value = "Lendo o arquivo...";
  busy.value = true;
  try {
    const d = await detectFile(f);
    detected.value = d;
    status.value = "";
    if (d.format === "ofx" || d.format === "pdf_statement") {
      selectedAccountId.value = d.matchedAccountId ?? "";
      step.value = "confirm";
    } else if (d.format === "csv") {
      await prepareCsv(f);
      step.value = "csv";
    } else if (d.format === "pdf") {
      step.value = "ai";
    } else {
      erro.value = "Não reconheci este arquivo. Use um extrato OFX, PDF do C6 ou CSV.";
    }
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  } finally {
    busy.value = false;
  }
}

async function prepareCsv(f: File) {
  csvText.value = decodeText(await readFileBytes(f));
  const firstLine = csvText.value.split("\n")[0] ?? "";
  csvHeaders.value = firstLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const headers = csvHeaders.value;
  mapping.value.dateColumn = headers.find((h) => /data|date|dt/i.test(h)) ?? headers[0] ?? "";
  mapping.value.amountColumn = headers.find((h) => /valor|amount|value|credit|debit/i.test(h)) ?? headers[1] ?? "";
  mapping.value.descriptionColumn = headers.find((h) => /hist|desc|memo|lancamento|name/i.test(h)) ?? "";
  try {
    savedMappings.value = (await http<Array<{ id: string; name: string; format: string; mapping: unknown }>>("GET", "/import/mappings")).filter((m) => m.format === "csv");
  } catch {
    /* mapeamentos salvos são opcionais */
  }
}

function applyMapping(m: { id: string; name: string; mapping: unknown }) {
  selectedMappingId.value = m.id;
  Object.assign(mapping.value, m.mapping);
}

async function saveMapping() {
  if (!mappingName.value.trim()) return;
  try {
    await http("POST", "/import/mappings", { name: mappingName.value.trim(), format: "csv", mapping: mapping.value });
    mappingName.value = "";
  } catch (e) {
    erro.value = (e as Error).message;
  }
}

function showPreview(data: { batchId: string; rows: PreviewRow[] }, p: StatementPreview | null) {
  preview.value = p;
  batchId.value = data.batchId;
  previewRows.value = data.rows.map((r) => ({ ...r, selected: !r.dup }));
  step.value = "preview";
}

async function runStatementPreview() {
  erro.value = "";
  if (!selectedAccountId.value) return;
  if (!detected.value?.text) {
    erro.value = "Não consegui ler o conteúdo do arquivo. Tente enviá-lo novamente.";
    return;
  }
  status.value = "Analisando...";
  busy.value = true;
  try {
    if (rememberAccount.value && canRemember.value) {
      try {
        await finance.updateAccount(selectedAccountId.value, { externalId: detected.value.accountRef });
      } catch {
        /* lembrar a conta é opcional e não bloqueia o preview */
      }
    }
    const format = detected.value.format === "ofx" ? "ofx" : "pdf_statement";
    const p = await previewStatement({ accountId: selectedAccountId.value, text: detected.value.text, format });
    showPreview(p, p);
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    status.value = "";
    busy.value = false;
  }
}

async function runCsvPreview() {
  erro.value = "";
  if (!selectedAccountId.value) { erro.value = "Selecione uma conta."; return; }
  status.value = "Analisando...";
  busy.value = true;
  try {
    const data = await http<{ batchId: string; rows: PreviewRow[] }>("POST", "/import/csv/preview", {
      accountId: selectedAccountId.value,
      mapping: mapping.value,
      csv: csvText.value,
    });
    showPreview(data, null);
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    status.value = "";
    busy.value = false;
  }
}

async function commit() {
  erro.value = "";
  status.value = "Importando...";
  busy.value = true;
  try {
    const rows = previewRows.value.filter((r) => r.selected);
    const result = await http<{ inserted: number; skipped: number }>("POST", `/import/${batchId.value}/commit`, {
      rows: rows.map(({ type, amountCents, date, postedDate, fingerprint, description }) => ({
        type, amountCents, date, postedDate: postedDate ?? null, fingerprint, description, accountId: selectedAccountId.value,
      })),
    });
    status.value = `${result.inserted} transações importadas${result.skipped ? ` (${result.skipped} já existiam)` : ""}.`;
    step.value = "done";
    await loadBatches();
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  } finally {
    busy.value = false;
  }
}

async function enqueuePdf() {
  if (!file.value) return;
  erro.value = "";
  status.value = "Enviando PDF...";
  busy.value = true;
  try {
    const { url, storagePath } = await http<{ url: string; storagePath: string }>("POST", "/ingest/upload-url", {
      ext: "pdf",
      contentType: "application/pdf",
    });
    await fetch(url, { method: "PUT", body: file.value, headers: { "content-type": "application/pdf" } });
    const { jobId } = await http<{ jobId: string }>("POST", "/import/pdf", { storagePath });
    status.value = `PDF enviado para análise! Job: ${jobId}. Os lançamentos aparecerão em "Para categorizar".`;
    step.value = "done";
  } catch (e) {
    erro.value = (e as Error).message;
    status.value = "";
  } finally {
    busy.value = false;
  }
}

async function undo(b: BatchSummary) {
  if (!window.confirm(`Desfazer esta importação? ${b.inserted} lançamento(s) serão apagados.`)) return;
  erro.value = "";
  busy.value = true;
  try {
    const { removed } = await undoBatch(b.id);
    status.value = `${removed} lançamento(s) removido(s).`;
    await loadBatches();
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function formatBRL(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function reset() {
  step.value = "upload";
  file.value = null;
  detected.value = null;
  preview.value = null;
  previewRows.value = [];
  batchId.value = "";
  csvText.value = "";
  csvHeaders.value = [];
  selectedAccountId.value = "";
  rememberAccount.value = true;
  selectedMappingId.value = "";
  mappingName.value = "";
  mapping.value.dateFormat = "DD/MM/YYYY";
  mapping.value.decimalSeparator = ",";
  mapping.value.expenseIsNegative = true;
  erro.value = "";
  status.value = "";
}
</script>

<template>
  <section class="import">
    <h2>Importar extrato</h2>

    <p v-if="erro" role="alert" class="error">{{ erro }}</p>
    <p v-if="status" class="status">{{ status }}</p>

    <!-- 1: solte o arquivo -->
    <div v-if="step === 'upload'" class="card">
      <label
        class="dropzone"
        :class="{ dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <strong>Solte o arquivo aqui ou clique para escolher</strong>
        <span class="hint">OFX, PDF do extrato do C6 ou CSV. O banco e a conta são reconhecidos pelo próprio arquivo.</span>
        <input type="file" accept=".ofx,.qfx,.pdf,.csv,application/pdf,text/csv" @change="onPick" />
      </label>
    </div>

    <!-- 2: arquivo reconhecido -->
    <div v-if="step === 'confirm' && detected" class="card">
      <h3>Arquivo reconhecido</h3>
      <dl class="detected">
        <dt>Banco</dt>
        <dd>{{ detected.institution ? INSTITUTION_LABEL[detected.institution] : "—" }}</dd>
        <dt>Tipo</dt>
        <dd>{{ kindLabel }}</dd>
        <dt>Conta no arquivo</dt>
        <dd>{{ detected.accountRef ?? "—" }}</dd>
      </dl>

      <p v-if="detected.kind === 'card_invoice'" class="hint">
        Faturas de cartão em OFX são importadas como lançamentos da conta de cartão escolhida.
      </p>

      <label class="field-label" for="import-account">Conta de destino</label>
      <select id="import-account" v-model="selectedAccountId">
        <option value="">— Selecione uma conta —</option>
        <option v-for="a in finance.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>
      <p v-if="detected.matchedAccountId" class="hint">Conta reconhecida pelo número do arquivo.</p>

      <label v-if="canRemember" class="remember">
        <input type="checkbox" v-model="rememberAccount" />
        Lembrar que o número {{ detected.accountRef }} é desta conta
      </label>

      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Trocar arquivo</button>
        <button :disabled="busy || !selectedAccountId || !isStatement" @click="runStatementPreview">Ver preview</button>
      </div>
    </div>

    <!-- 2b: CSV com mapeamento manual -->
    <div v-if="step === 'csv'" class="card">
      <h3>CSV: mapeamento de colunas</h3>
      <label class="field-label" for="csv-account">Conta</label>
      <select id="csv-account" v-model="selectedAccountId">
        <option value="">— Selecione uma conta —</option>
        <option v-for="a in finance.accounts" :key="a.id" :value="a.id">{{ a.name }}</option>
      </select>

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

      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Trocar arquivo</button>
        <button :disabled="busy || !selectedAccountId || !csvText" @click="runCsvPreview">Ver preview</button>
      </div>
    </div>

    <!-- 2c: PDF de banco desconhecido → IA -->
    <div v-if="step === 'ai'" class="card">
      <h3>Não reconheci o banco deste PDF</h3>
      <p class="hint">A IA pode extrair os lançamentos. Eles aparecerão em "Para categorizar" para confirmação.</p>
      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Trocar arquivo</button>
        <button :disabled="busy" @click="enqueuePdf">Interpretar com IA</button>
      </div>
    </div>

    <!-- 3: preview -->
    <div v-if="step === 'preview'" class="card">
      <h3>Preview ({{ selectedCount }} de {{ previewRows.length }} selecionados)</h3>

      <p :class="['balance', balance.tone]">{{ balance.text }}</p>
      <ul v-if="preview?.balanceCheck && !preview.balanceCheck.ok" class="mismatches">
        <li v-for="m in preview.balanceCheck.mismatches.slice(0, 3)" :key="m.dateISO">
          {{ formatDate(m.dateISO) }}: esperado {{ formatBRL(m.expectedCents) }}, calculado {{ formatBRL(m.computedCents) }}
        </li>
        <li v-if="preview.balanceCheck.mismatches.length > 3">
          e mais {{ preview.balanceCheck.mismatches.length - 3 }}…
        </li>
      </ul>
      <p v-if="preview?.balanceCheck && !preview.balanceCheck.ok" class="hint">
        A divergência não impede a importação, mas indica que o arquivo pode estar incompleto.
      </p>

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
          <span>{{ formatDate(row.date) }}</span>
          <span :class="row.type">{{ row.type === 'income' ? 'receita' : 'despesa' }}</span>
          <span>{{ formatBRL(row.amountCents) }}</span>
          <span class="desc">{{ row.description ?? '—' }} {{ row.dup ? '⚠' : '' }}</span>
        </div>
      </div>

      <div class="btn-row">
        <button class="btn-secondary" @click="reset">Cancelar</button>
        <button @click="commit" :disabled="busy || selectedCount === 0">
          Importar {{ selectedCount }} lançamento{{ selectedCount !== 1 ? 's' : '' }}
        </button>
      </div>
    </div>

    <!-- 4: concluído -->
    <div v-if="step === 'done'" class="card">
      <h3>Concluído</h3>
      <p>{{ status }}</p>
      <button @click="reset">Nova importação</button>
    </div>

    <!-- histórico -->
    <div class="card" v-if="batches.length">
      <h3>Importações anteriores</h3>
      <div class="history">
        <div v-for="b in batches" :key="b.id" :class="['history-row', { undone: b.undoneAt }]">
          <div class="history-info">
            <strong>{{ b.institution ? INSTITUTION_LABEL[b.institution] : b.format.toUpperCase() }}</strong>
            <span>{{ b.accountName ?? "—" }}</span>
            <span class="hint">{{ formatDate(b.createdAt) }} · {{ b.inserted }} de {{ b.rowCount }} lançamentos</span>
          </div>
          <span v-if="b.undoneAt" class="hint">desfeita</span>
          <span v-else-if="b.balanceOk === false" class="balance warn" title="Houve divergência de saldo no preview">⚠ saldo</span>
          <button v-if="!b.undoneAt" class="btn-small" :disabled="busy" @click="undo(b)">Desfazer</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.import { padding: calc(var(--space) * 3); max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
h2 { margin-bottom: 0; }
.card { background: var(--color-surface); padding: calc(var(--space) * 3); border-radius: var(--radius); display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
h3 { margin: 0; font-size: 1rem; }
.dropzone { position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--space); padding: calc(var(--space) * 6) calc(var(--space) * 3); border: 2px dashed #444; border-radius: var(--radius); cursor: pointer; text-align: center; }
.dropzone.dragging { border-color: var(--color-primary); background: rgba(79,124,255,.07); }
.dropzone input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip: rect(0 0 0 0); }
.dropzone:focus-within { border-color: var(--color-primary); }
.detected { display: grid; grid-template-columns: 1fr 2fr; gap: var(--space) calc(var(--space) * 2); margin: 0; font-size: 0.9rem; }
.detected dt { opacity: 0.6; }
.detected dd { margin: 0; font-weight: 600; }
.remember { display: flex; align-items: center; gap: var(--space); font-size: 0.85rem; cursor: pointer; }
.field-label { font-size: 0.85rem; opacity: 0.7; margin-bottom: -8px; }
select, input[type="text"], input:not([type]) {
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
.balance { font-size: 0.9rem; font-weight: 600; }
.balance.ok { color: #2ecc71; }
.balance.warn { color: #f39c12; }
.balance.neutral { opacity: 0.7; font-weight: 400; }
.mismatches { margin: 0; padding-left: calc(var(--space) * 3); font-size: 0.85rem; color: #f39c12; }
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
.history { display: flex; flex-direction: column; gap: var(--space); }
.history-row { display: flex; align-items: center; gap: calc(var(--space) * 2); padding: calc(var(--space) * 1.5) 0; border-bottom: 1px solid #222; }
.history-row:last-child { border-bottom: none; }
.history-row.undone { opacity: 0.5; }
.history-info { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 0.9rem; }
.error { color: #e74c3c; font-size: 0.9rem; }
.status { font-size: 0.9rem; opacity: 0.8; }
</style>
