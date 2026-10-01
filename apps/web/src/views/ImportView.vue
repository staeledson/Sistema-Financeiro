<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { http } from "../lib/http";
import { useFinanceStore } from "../stores/finance";
import { formatBRL } from "../lib/money";
import { formatAdjustment } from "../lib/money-input";
import { ENTITY_LABEL, INSTITUTION_LABEL, type AccountEntity } from "../lib/entity";
import { buildCreateAccountPayload, emptyAccountForm } from "../lib/account-form";
import {
  balanceSummary, detectFile, previewStatement, undoBatch, listBatches, decodeText, readFileBytes, formatDate,
  nextCardRef, rowTags, commitImport,
  type BatchSummary, type DetectResponse, type PreviewRow, type StatementPreview,
} from "../lib/import-client";
import {
  assignGroup, balanceState, compatibleAccounts, detectAll, groupUnmatched, newRowCount, previewPending,
  runCommit, shouldRemember, sortChronologically, summarize,
  type BatchEntry, type UnmatchedGroup, type UnsupportedFile,
} from "../lib/import-batch";

const finance = useFinanceStore();

type Step = "upload" | "confirm" | "csv" | "ai" | "preview" | "done" | "lote";
type SelectableRow = PreviewRow & { selected: boolean; tags: ReturnType<typeof rowTags> };

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
// Saldo do extrato x saldo do sistema (passo "done", só extrato de conta com saldo corrente declarado)
const reconcileInfo = ref<{ accountId: string; accountName: string; dateISO: string; statementCents: number; systemCents: number; later: boolean } | null>(null);
const reconcileNotice = ref("");
const batches = ref<BatchSummary[]>([]);

// Fatura de cartão em CSV: o arquivo traz vários cartões e importamos um por vez
const NEW_CARD = "__new__";
const doneCardRefs = ref<string[]>([]);
const skippedCardRefs = ref<string[]>([]);
const currentCardRef = ref<string | null>(null);
const invoiceInserted = ref(0);
const invoiceSkipped = ref(0);
const newCard = ref({ name: "", entity: "pf" as AccountEntity, closingDay: null as number | null, dueDay: null as number | null, limitReais: null as number | null });

// Lote: vários arquivos de uma vez (extratos e faturas já suportados pelo preview)
const batchEntries = ref<BatchEntry[]>([]);
const batchUnsupported = ref<UnsupportedFile[]>([]);
const batchRemember = ref<Record<string, boolean>>({});
const batchFailure = ref<{ key: string; message: string } | null>(null);
const batchNotRun = ref<string[]>([]);

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
  if (!finance.categories.length) {
    try {
      await finance.loadCategories();
    } catch {
      /* os nomes das categorias sugeridas são secundários */
    }
  }
  await loadBatches();
});

const balance = computed(() => balanceSummary(preview.value?.balanceCheck ?? null));
const selectedCount = computed(() => previewRows.value.filter((r) => r.selected).length);
const selectedAccount = computed(() => finance.accounts.find((a) => a.id === selectedAccountId.value));
// número/final que o arquivo traz: o do cartão da vez (fatura CSV) ou o da conta (OFX/PDF)
const fileRef = computed(() => currentCardRef.value ?? detected.value?.accountRef ?? null);
const isCardFile = computed(() => detected.value?.kind === "card_invoice");
const canRemember = computed(
  () =>
    !!fileRef.value &&
    !!selectedAccount.value &&
    // fatura de cartão só vale para conta de cartão: não grava externalId em conta comum antes do 400 da API
    (!isCardFile.value || selectedAccount.value.type === "credit_card") &&
    !selectedAccount.value.externalId &&
    !finance.accounts.some((a) => a.externalId === fileRef.value),
);
const kindLabel = computed(() => (detected.value?.kind === "card_invoice" ? "Fatura de cartão" : "Extrato de conta"));
// isInvoice: fila de cartões do CSV; isCardFile: qualquer fatura de cartão (CSV ou OFX), que só importa para conta de cartão
const isInvoice = computed(() => detected.value?.format === "csv_invoice");
const isStatement = computed(() => detected.value?.format === "ofx" || detected.value?.format === "pdf_statement" || isInvoice.value);
const cardAccounts = computed(() => finance.accounts.filter((a) => a.type === "credit_card"));
const destinationAccounts = computed(() => (isCardFile.value ? cardAccounts.value : finance.accounts));
const creatingCard = computed(() => isCardFile.value && selectedAccountId.value === NEW_CARD);
const cardPosition = computed(() => {
  const total = detected.value?.accountRefs.length ?? 0;
  return `${doneCardRefs.value.length + 1} de ${total}`;
});
const showBankCategory = computed(() => previewRows.value.some((r) => !!r.bankCategory));
const showSuggestion = computed(() => previewRows.value.some((r) => !!r.categoryId));
const previewColumns = computed(
  () => `28px 100px 80px 110px ${showBankCategory.value ? "minmax(90px, 1fr) " : ""}${showSuggestion.value ? "minmax(90px, 1fr) " : ""}minmax(120px, 2fr)`,
);

const batchOrdered = computed(() => sortChronologically(batchEntries.value.filter((e) => e.preview || e.previewError)));
const batchGroups = computed(() => groupUnmatched(batchEntries.value));
const batchPending = computed(() => batchEntries.value.filter((e) => e.selected && e.preview && e.accountId && !e.result));
const batchSummary = computed(() => summarize(batchEntries.value));
const batchHasMismatch = computed(() => batchEntries.value.some((e) => e.preview && balanceState(e.preview) === "mismatch"));
const batchComplete = computed(() => batchSummary.value.files > 0 && batchPending.value.length === 0 && !batchFailure.value);

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function entryLabel(e: BatchEntry): string {
  return e.card && e.ref ? `${e.fileName} · cartão final ${e.ref}` : e.fileName;
}

function accountName(id: string | null): string {
  return (id && finance.accounts.find((a) => a.id === id)?.name) || "—";
}

function resultText(r: { inserted: number; skipped: number }): string {
  const dup = r.skipped ? ` (${plural(r.skipped, "já existia", "já existiam")})` : "";
  return `${plural(r.inserted, "importado", "importados")}${dup}`;
}

function groupTitle(g: UnmatchedGroup): string {
  if (g.card) return g.ref ? `Cartão final ${g.ref}` : "Cartão do arquivo";
  return g.ref ? `Conta ${g.ref}` : "Conta do arquivo";
}

function batchPeriod(e: BatchEntry): string {
  const p = e.preview?.period;
  return p ? `${formatDate(p.from)} a ${formatDate(p.to)}` : "—";
}

function batchResultCell(e: BatchEntry): string {
  if (e.result) return resultText(e.result);
  if (batchFailure.value?.key === e.key) return `falhou: ${batchFailure.value.message}`;
  if (batchNotRun.value.includes(e.key)) return "não processado";
  return "—";
}

function categoryName(id: string | null | undefined): string {
  return (id && finance.categories.find((c) => c.id === id)?.name) || "—";
}

function defaultCardName(ref: string | null): string {
  if (!ref) return "Cartão";
  return ref.length <= 4 ? `Cartão final ${ref}` : `Cartão ${ref}`;
}

function resetNewCard(ref: string | null) {
  newCard.value = { name: defaultCardName(ref), entity: "pf", closingDay: null, dueDay: null, limitReais: null };
}

function selectCard(ref: string) {
  currentCardRef.value = ref;
  selectedAccountId.value = detected.value?.matchedAccounts[ref] ?? "";
  resetNewCard(ref);
}

/** Cartão da vez resolvido (importado ou pulado): vai para o próximo ou fecha com o resumo. */
function advanceQueue(message: string) {
  const d = detected.value;
  if (!d) return;
  erro.value = "";
  preview.value = null;
  previewRows.value = [];
  batchId.value = "";
  const next = nextCardRef(d.accountRefs, doneCardRefs.value);
  if (next) {
    selectCard(next);
    status.value = message;
    step.value = "confirm";
    return;
  }
  const imported = doneCardRefs.value.length - skippedCardRefs.value.length;
  const dup = invoiceSkipped.value ? ` (${invoiceSkipped.value} já existiam)` : "";
  const head = imported === 0
    ? "Nenhum cartão importado."
    : `${imported} ${imported === 1 ? "cartão" : "cartões"}, ${invoiceInserted.value} transações importadas${dup}.`;
  const skipped = skippedCardRefs.value.length
    ? ` Cartões pulados: ${skippedCardRefs.value.map((r) => `final ${r}`).join(", ")}.`
    : "";
  status.value = head + skipped;
  step.value = "done";
}

function skipCard() {
  const ref = currentCardRef.value;
  if (!isInvoice.value || !ref) return;
  doneCardRefs.value.push(ref);
  skippedCardRefs.value.push(ref);
  advanceQueue(`Cartão final ${ref} pulado.`);
}

function cancelPreview() {
  if (!isInvoice.value) { reset(); return; }
  erro.value = "";
  status.value = "";
  preview.value = null;
  previewRows.value = [];
  batchId.value = "";
  step.value = "confirm";
}

async function createCard() {
  erro.value = "";
  const ref = fileRef.value;
  const nc = newCard.value;
  if (!nc.name.trim()) { erro.value = "Nome obrigatório."; return; }
  if (typeof nc.limitReais === "number" && nc.limitReais < 0) { erro.value = "O limite não pode ser negativo."; return; }
  for (const day of [nc.closingDay, nc.dueDay]) {
    if (typeof day === "number" && (!Number.isInteger(day) || day < 1 || day > 31)) {
      erro.value = "Os dias de fechamento e vencimento vão de 1 a 31.";
      return;
    }
  }
  busy.value = true;
  try {
    const acc = await finance.createAccount(
      buildCreateAccountPayload({
        ...emptyAccountForm(),
        type: "credit_card",
        name: nc.name,
        entity: nc.entity,
        institution: detected.value?.institution ?? "other",
        externalId: ref ?? "",
        closingDay: nc.closingDay,
        dueDay: nc.dueDay,
        creditLimitReais: nc.limitReais,
      }),
    );
    selectedAccountId.value = acc.id;
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function loadBatches() {
  try {
    batches.value = await listBatches();
  } catch {
    /* histórico é secundário */
  }
}

function handleFiles(list: ArrayLike<File> | null | undefined) {
  const files = Array.from(list ?? []);
  if (files.length === 1) void handleFile(files[0]);
  else if (files.length > 1) void startBatch(files);
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  handleFiles(files);
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  handleFiles(e.dataTransfer?.files);
}

async function startBatch(files: File[]) {
  if (busy.value) return;
  erro.value = "";
  batchEntries.value = [];
  batchUnsupported.value = [];
  batchRemember.value = {};
  batchFailure.value = null;
  batchNotRun.value = [];
  step.value = "lote";
  busy.value = true;
  try {
    status.value = "Lendo os arquivos...";
    const r = await detectAll(files, detectFile, finance.accounts, (i, n) => { status.value = `Lendo arquivo ${i} de ${n}...`; });
    batchUnsupported.value = r.unsupported;
    batchEntries.value = r.entries;
    batchEntries.value = await previewPending(r.entries, previewStatement, (e, i, n) => { status.value = `Analisando ${i} de ${n}: ${entryLabel(e)}...`; });
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    status.value = "";
    busy.value = false;
  }
}

async function chooseGroupAccount(g: UnmatchedGroup, accountId: string) {
  if (!accountId || busy.value) return;
  erro.value = "";
  busy.value = true;
  try {
    if (batchRemember.value[g.key] !== false && shouldRemember(g.ref, accountId, finance.accounts)) {
      try {
        await finance.updateAccount(accountId, { externalId: g.ref });
      } catch {
        /* lembrar a conta é opcional e não bloqueia a análise */
      }
    }
    batchEntries.value = assignGroup(batchEntries.value, g.key, accountId);
    batchEntries.value = await previewPending(batchEntries.value, previewStatement, (e, i, n) => { status.value = `Analisando ${i} de ${n}: ${entryLabel(e)}...`; });
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    status.value = "";
    busy.value = false;
  }
}

async function importBatch() {
  if (busy.value || !batchPending.value.length) return;
  erro.value = "";
  batchFailure.value = null;
  batchNotRun.value = [];
  busy.value = true;
  try {
    const run = await runCommit(batchEntries.value, commitImport, (e, i, n) => {
      status.value = `Importando ${i} de ${n}: ${entryLabel(e)}...`;
    });
    const results = new Map(run.done.map((d) => [d.entry.key, { inserted: d.inserted, skipped: d.skipped }]));
    batchEntries.value = batchEntries.value.map((e) => (results.has(e.key) ? { ...e, result: results.get(e.key) ?? null } : e));
    if (run.failed) {
      batchFailure.value = { key: run.failed.entry.key, message: run.failed.message };
      batchNotRun.value = run.remaining.map((e) => e.key);
      const n = run.remaining.length;
      erro.value = `Falha ao importar "${entryLabel(run.failed.entry)}": ${run.failed.message}. `
        + (n ? `${plural(n, "arquivo não foi processado", "arquivos não foram processados")}.` : "Nenhum outro arquivo ficou para trás.");
    }
    await loadBatches();
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    status.value = "";
    busy.value = false;
  }
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
    if (d.format === "csv_invoice") {
      doneCardRefs.value = [];
      skippedCardRefs.value = [];
      invoiceInserted.value = 0;
      invoiceSkipped.value = 0;
      const first = nextCardRef(d.accountRefs, []);
      if (!first) {
        erro.value = "Não encontrei cartões neste arquivo.";
      } else {
        selectCard(first);
        step.value = "confirm";
      }
    } else if (d.format === "ofx" || d.format === "pdf_statement") {
      // fatura de cartão em OFX: a conta casada só vale se for de cartão (o seletor só lista cartões)
      const matched = d.matchedAccountId ?? "";
      selectedAccountId.value = d.kind === "card_invoice" && !cardAccounts.value.some((a) => a.id === matched) ? "" : matched;
      if (d.kind === "card_invoice") resetNewCard(d.accountRef);
      step.value = "confirm";
    } else if (d.format === "csv") {
      await prepareCsv(f);
      step.value = "csv";
    } else if (d.format === "pdf") {
      step.value = "ai";
    } else {
      erro.value = "Não reconheci este arquivo. Use um extrato OFX, PDF do C6 ou do Mercado Pago, CSV ou a fatura do cartão C6 em CSV.";
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

/** Depois do commit: busca o saldo do sistema para compará-lo com o saldo corrente que o extrato declara. */
async function loadReconcileInfo(p: StatementPreview | null) {
  reconcileInfo.value = null;
  reconcileNotice.value = "";
  const declared = p?.statementBalance;
  const account = selectedAccount.value;
  if (!declared?.current || !account || account.type === "credit_card") return;
  try {
    await finance.loadBalances();
    const system = finance.balances?.accounts.find((b) => b.accountId === account.id);
    if (system) {
      reconcileInfo.value = {
        accountId: account.id, accountName: account.name, dateISO: declared.dateISO,
        statementCents: declared.balanceCents, systemCents: system.balanceCents, later: p?.laterActivity === true,
      };
    }
  } catch {
    /* a comparação é um extra: a importação já foi concluída */
  }
}

async function adjustOpeningBalance() {
  const info = reconcileInfo.value;
  if (!info || info.later || busy.value) return;
  const diff = info.statementCents - info.systemCents;
  const ok = window.confirm(
    `Ajustar o saldo inicial da conta "${info.accountName}" para que o saldo de hoje seja ${formatBRL(info.statementCents)} `
      + `(saldo do extrato em ${formatDate(info.dateISO)})?\nAjuste de saldo inicial: ${formatAdjustment(diff)}.`,
  );
  if (!ok) return;
  erro.value = "";
  busy.value = true;
  try {
    const r = await finance.reconcileAccount(info.accountId, info.statementCents);
    reconcileInfo.value = { ...info, systemCents: r.newBalanceCents };
    reconcileNotice.value = `Saldo conciliado: ${formatBRL(r.newBalanceCents)} (ajuste de saldo inicial: ${formatAdjustment(r.adjustmentCents)})`;
  } catch (e) {
    erro.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function showPreview(data: { batchId: string; rows: PreviewRow[] }, p: StatementPreview | null) {
  preview.value = p;
  batchId.value = data.batchId;
  previewRows.value = data.rows.map((r) => ({ ...r, selected: !r.dup, tags: rowTags(r.description) }));
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
        await finance.updateAccount(selectedAccountId.value, { externalId: fileRef.value });
      } catch {
        /* lembrar a conta é opcional e não bloqueia o preview */
      }
    }
    const body = isInvoice.value
      ? { accountId: selectedAccountId.value, text: detected.value.text, format: "csv_invoice" as const, cardRef: currentCardRef.value ?? undefined }
      : { accountId: selectedAccountId.value, text: detected.value.text, format: (detected.value.format === "ofx" ? "ofx" : "pdf_statement") as "ofx" | "pdf_statement" };
    const p = await previewStatement(body);
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
      rows: rows.map(({ type, amountCents, date, postedDate, fingerprint, description, categoryId }) => ({
        type, amountCents, date, postedDate: postedDate ?? null, fingerprint, description, accountId: selectedAccountId.value,
        categoryId: categoryId ?? null,
      })),
    });
    const dupNote = result.skipped ? ` (${result.skipped} já existiam)` : "";
    if (isInvoice.value && currentCardRef.value) {
      const doneRef = currentCardRef.value;
      doneCardRefs.value.push(doneRef);
      invoiceInserted.value += result.inserted;
      invoiceSkipped.value += result.skipped;
      advanceQueue(`Cartão final ${doneRef}: ${result.inserted} transações importadas${dupNote}.`);
    } else {
      status.value = `${result.inserted} transações importadas${dupNote}.`;
      step.value = "done";
      await loadReconcileInfo(preview.value);
    }
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
  // o saldo do sistema muda com o desfazer: a comparação do passo concluído ficaria velha
  reconcileInfo.value = null;
  reconcileNotice.value = "";
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


function reset() {
  step.value = "upload";
  reconcileInfo.value = null;
  reconcileNotice.value = "";
  file.value = null;
  detected.value = null;
  preview.value = null;
  previewRows.value = [];
  batchId.value = "";
  csvText.value = "";
  csvHeaders.value = [];
  selectedAccountId.value = "";
  doneCardRefs.value = [];
  skippedCardRefs.value = [];
  currentCardRef.value = null;
  invoiceInserted.value = 0;
  invoiceSkipped.value = 0;
  rememberAccount.value = true;
  batchEntries.value = [];
  batchUnsupported.value = [];
  batchRemember.value = {};
  batchFailure.value = null;
  batchNotRun.value = [];
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
  <section class="import" :class="{ wide: step === 'lote' }">
    <h2>Importar extrato</h2>

    <p v-if="erro" role="alert" class="text-error">{{ erro }}</p>
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
        <span class="hint">OFX, PDF do extrato do C6, CSV ou a fatura do cartão C6 em CSV. O banco e a conta são reconhecidos pelo próprio arquivo.</span>
        <span class="hint">Pode escolher vários arquivos de uma vez para importar em lote.</span>
        <input type="file" multiple accept=".ofx,.qfx,.pdf,.csv,application/pdf,text/csv" @change="onPick" />
      </label>
    </div>

    <!-- 2: arquivo reconhecido -->
    <div v-if="step === 'confirm' && detected" class="card">
      <h3>Arquivo reconhecido</h3>
      <p v-if="isInvoice && currentCardRef" class="card-step">Cartão final {{ currentCardRef }} ({{ cardPosition }})</p>
      <dl class="detected">
        <dt>Banco</dt>
        <dd>{{ detected.institution ? INSTITUTION_LABEL[detected.institution] : "—" }}</dd>
        <dt>Tipo</dt>
        <dd>{{ kindLabel }}</dd>
        <template v-if="isInvoice">
          <dt>Cartão no arquivo</dt>
          <dd>final {{ currentCardRef }}</dd>
        </template>
        <template v-else>
          <dt>Conta no arquivo</dt>
          <dd>{{ detected.accountRef ?? "—" }}</dd>
        </template>
      </dl>

      <p v-if="detected.kind === 'card_invoice' && !isInvoice" class="hint">
        Faturas de cartão (CSV do C6 ou OFX) são importadas como lançamentos da conta de cartão escolhida.
      </p>

      <label class="field-label" for="import-account">{{ isCardFile ? "Cartão de destino" : "Conta de destino" }}</label>
      <select id="import-account" v-model="selectedAccountId">
        <option value="">{{ isCardFile ? "— Selecione um cartão —" : "— Selecione uma conta —" }}</option>
        <option v-for="a in destinationAccounts" :key="a.id" :value="a.id">{{ a.name }}</option>
        <option v-if="isCardFile" :value="NEW_CARD">Criar cartão</option>
      </select>
      <p v-if="isInvoice && currentCardRef && detected.matchedAccounts[currentCardRef]" class="hint">Cartão reconhecido pelo final do arquivo.</p>
      <p v-else-if="!isInvoice && detected.matchedAccountId && selectedAccountId === detected.matchedAccountId" class="hint">Conta reconhecida pelo número do arquivo.</p>

      <div v-if="creatingCard" class="new-card">
        <label class="field-label" for="new-card-name">Nome do cartão</label>
        <input id="new-card-name" v-model="newCard.name" type="text" />
        <label class="field-label" for="new-card-entity">Titular</label>
        <select id="new-card-entity" v-model="newCard.entity">
          <option v-for="(label, value) in ENTITY_LABEL" :key="value" :value="value">{{ label }}</option>
        </select>
        <label class="field-label" for="new-card-closing">Dia de fechamento (1–31)</label>
        <input id="new-card-closing" v-model.number="newCard.closingDay" type="number" min="1" max="31" />
        <label class="field-label" for="new-card-due">Dia de vencimento (1–31)</label>
        <input id="new-card-due" v-model.number="newCard.dueDay" type="number" min="1" max="31" />
        <label class="field-label" for="new-card-limit">Limite (R$, opcional)</label>
        <input id="new-card-limit" v-model.number="newCard.limitReais" type="number" min="0" step="0.01" />
        <div class="btn-row">
          <button id="new-card-create" type="button" :disabled="busy" @click="createCard">Criar e selecionar</button>
        </div>
      </div>

      <label v-if="canRemember" class="remember">
        <input type="checkbox" v-model="rememberAccount" />
        Lembrar que o número {{ detected.accountRef }} é desta conta
      </label>

      <div class="btn-row">
        <button type="button" class="btn-secondary" :disabled="busy" @click="reset">Trocar arquivo</button>
        <button v-if="isInvoice" type="button" class="btn-secondary" :disabled="busy" @click="skipCard">Pular este cartão</button>
        <button type="button" :disabled="busy || !selectedAccountId || creatingCard || !isStatement" @click="runStatementPreview">Ver preview</button>
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
          type="button"
          :class="['btn-small', 'btn-secondary', { active: selectedMappingId === m.id }]"
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
        <button type="button" class="btn-small btn-secondary" @click="saveMapping" :disabled="!mappingName.trim()">Salvar mapeamento</button>
      </div>

      <div class="btn-row">
        <button type="button" class="btn-secondary" :disabled="busy" @click="reset">Trocar arquivo</button>
        <button type="button" :disabled="busy || !selectedAccountId || !csvText" @click="runCsvPreview">Ver preview</button>
      </div>
    </div>

    <!-- 2c: PDF de banco desconhecido → IA -->
    <div v-if="step === 'ai'" class="card">
      <h3>Não reconheci o banco deste PDF</h3>
      <p class="hint">A IA pode extrair os lançamentos. Eles aparecerão em "Para categorizar" para confirmação.</p>
      <div class="btn-row">
        <button type="button" class="btn-secondary" :disabled="busy" @click="reset">Trocar arquivo</button>
        <button type="button" :disabled="busy" @click="enqueuePdf">Interpretar com IA</button>
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
        <button type="button" class="btn-small btn-secondary" @click="previewRows.forEach(r => !r.dup && (r.selected = true))">Selecionar novos</button>
        <button type="button" class="btn-small btn-secondary" @click="previewRows.forEach(r => r.selected = !r.dup)">Reset seleção</button>
      </div>

      <div class="preview-table" :style="{ '--cols': previewColumns }">
        <div class="preview-row header">
          <span></span><span>Data</span><span>Tipo</span><span>Valor</span>
          <span v-if="showBankCategory">Categoria do banco</span><span v-if="showSuggestion">Sugestão</span><span>Descrição</span>
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
          <span v-if="showBankCategory" class="desc">{{ row.bankCategory ?? '—' }}</span>
          <span v-if="showSuggestion" class="desc">{{ categoryName(row.categoryId) }}</span>
          <span class="desc">
            {{ row.description ?? '—' }} {{ row.dup ? '⚠' : '' }}
            <template v-if="isInvoice">
              <span v-if="row.tags.installment" class="tag">parcela {{ row.tags.installment }}</span>
              <span v-if="row.tags.usd" class="tag">US$</span>
            </template>
          </span>
        </div>
      </div>

      <div class="btn-row">
        <button type="button" class="btn-secondary" :disabled="busy" @click="cancelPreview">Cancelar</button>
        <button v-if="isInvoice" type="button" class="btn-secondary" :disabled="busy" @click="skipCard">Pular este cartão</button>
        <button type="button" @click="commit" :disabled="busy || selectedCount === 0">
          Importar {{ selectedCount }} lançamento{{ selectedCount !== 1 ? 's' : '' }}
        </button>
      </div>
    </div>

    <!-- 3b: lote de vários arquivos -->
    <div v-if="step === 'lote'" class="card" data-test="batch">
      <h3>Importação em lote</h3>

      <div v-if="batchUnsupported.length" class="batch-section">
        <h4>Fora do lote</h4>
        <ul class="batch-list">
          <li v-for="u in batchUnsupported" :key="u.fileName">
            <strong>{{ u.fileName }}</strong>: precisa ser importado individualmente. {{ u.reason }}
          </li>
        </ul>
      </div>

      <div v-if="batchGroups.length" class="batch-section">
        <h4>Arquivos aguardando conta</h4>
        <p class="hint">Escolha a conta de cada grupo. Os arquivos ficam fora da importação até isso.</p>
        <div v-for="(g, i) in batchGroups" :key="g.key" class="batch-group">
          <label class="field-label" :for="`lote-conta-${i}`">
            {{ groupTitle(g) }} ({{ g.fileNames.join(", ") }})
          </label>
          <select :id="`lote-conta-${i}`" :disabled="busy" @change="chooseGroupAccount(g, ($event.target as HTMLSelectElement).value)">
            <option value="">{{ g.card ? "— Selecione um cartão —" : "— Selecione uma conta —" }}</option>
            <option v-for="a in compatibleAccounts(g.card, finance.accounts)" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
          <p v-if="g.card && !compatibleAccounts(true, finance.accounts).length" class="hint">
            Nenhum cartão cadastrado. Crie o cartão em Contas ou importe este arquivo individualmente.
          </p>
          <label v-if="g.ref && /^\d+$/.test(g.ref)" class="remember">
            <input
              type="checkbox"
              aria-label="Lembrar esta conta para os próximos arquivos"
              :checked="batchRemember[g.key] !== false"
              :disabled="busy"
              @change="batchRemember[g.key] = ($event.target as HTMLInputElement).checked"
            />
            Lembrar esta conta para os próximos arquivos
          </label>
        </div>
      </div>

      <div v-if="batchOrdered.length" class="batch-section">
        <p v-if="batchHasMismatch" class="balance warn">
          Há arquivos com divergência de saldo: eles podem estar incompletos e ficam desmarcados. Marque só se quiser importar assim mesmo.
        </p>
        <div class="table-wrap">
          <table class="batch-table">
            <caption class="sr-only">Arquivos analisados, em ordem cronológica</caption>
            <thead>
              <tr>
                <th scope="col">Importar</th><th scope="col">Arquivo</th><th scope="col">Banco</th><th scope="col">Conta</th>
                <th scope="col">Período</th><th scope="col">Lançamentos</th><th scope="col">Já importados</th>
                <th scope="col">Saldo</th><th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in batchOrdered" :key="e.key" :class="{ done: !!e.result }">
                <td>
                  <input
                    v-if="e.preview"
                    v-model="e.selected"
                    type="checkbox"
                    :aria-label="`Importar ${entryLabel(e)}`"
                    :disabled="busy || !!e.result || newRowCount(e.preview) === 0"
                  />
                </td>
                <td class="batch-file">{{ entryLabel(e) }}</td>
                <template v-if="e.preview">
                  <td>{{ (e.preview.institution ?? e.institution) ? INSTITUTION_LABEL[(e.preview.institution ?? e.institution)!] : "—" }}</td>
                  <td>{{ accountName(e.accountId) }}</td>
                  <td>{{ batchPeriod(e) }}</td>
                  <td>
                    {{ e.preview.rowCount }}
                    <span v-if="newRowCount(e.preview) === 0" class="hint">nada novo</span>
                  </td>
                  <td>{{ e.preview.dupCount }}</td>
                  <td>
                    <span v-if="balanceState(e.preview) === 'ok'" class="balance ok">✔ confere</span>
                    <span v-else-if="balanceState(e.preview) === 'mismatch'" class="balance warn">✘ divergência</span>
                    <span v-else class="hint">—</span>
                  </td>
                </template>
                <td v-else colspan="6" class="text-error">Não foi possível analisar: {{ e.previewError }}</td>
                <td>{{ batchResultCell(e) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="batchSummary.files > 0" class="batch-section" data-test="batch-result">
        <h4>Importado</h4>
        <ul class="batch-list">
          <li v-for="e in batchEntries.filter((x) => x.result)" :key="e.key">
            {{ entryLabel(e) }}: {{ resultText(e.result!) }}
          </li>
        </ul>
        <p><strong>Total: {{ resultText(batchSummary) }}</strong></p>
        <p>
          <RouterLink to="/categorizar">Para categorizar</RouterLink>
          · Depois de importar, rode "Recategorizar pendentes" para aplicar regras e IA aos lançamentos novos.
        </p>
        <p class="hint">Para acertar o saldo, use Conciliar saldo em Contas.</p>
      </div>

      <div class="btn-row">
        <button type="button" class="btn-secondary" :disabled="busy" @click="reset">{{ batchComplete ? "Nova importação" : "Trocar arquivos" }}</button>
        <button v-if="batchFailure" type="button" :disabled="busy" @click="importBatch">Tentar de novo os restantes</button>
        <button v-else-if="!batchComplete" type="button" :disabled="busy || batchPending.length === 0" @click="importBatch">
          Importar {{ plural(batchPending.length, "arquivo", "arquivos") }}
        </button>
      </div>
    </div>

    <!-- 4: concluído -->
    <div v-if="step === 'done'" class="card">
      <h3>Concluído</h3>
      <p>{{ status }}</p>
      <div v-if="reconcileInfo" class="reconcile-info">
        <p data-test="statement-balance-line">
          Saldo do extrato em {{ formatDate(reconcileInfo.dateISO) }}: {{ formatBRL(reconcileInfo.statementCents) }} · saldo no sistema hoje: {{ formatBRL(reconcileInfo.systemCents) }}
        </p>
        <p v-if="reconcileInfo.later && reconcileInfo.statementCents !== reconcileInfo.systemCents" class="hint">
          Há lançamentos posteriores à data deste extrato; use Contas → Conciliar saldo com o saldo real de hoje.
        </p>
        <template v-else-if="reconcileInfo.statementCents !== reconcileInfo.systemCents">
          <p class="hint">
            O extrato cobre só um período; o saldo anterior a ele pode nunca ter sido informado.
            O ajuste muda o saldo inicial da conta em {{ formatAdjustment(reconcileInfo.statementCents - reconcileInfo.systemCents) }}.
          </p>
          <button type="button" class="btn-secondary" :disabled="busy" @click="adjustOpeningBalance">Ajustar saldo inicial da conta</button>
        </template>
        <p v-if="reconcileNotice" role="status" class="balance ok">{{ reconcileNotice }}</p>
      </div>
      <button type="button" @click="reset">Nova importação</button>
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
          <button v-if="!b.undoneAt" type="button" class="btn-small btn-secondary" :disabled="busy" @click="undo(b)">Desfazer</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.import.wide { max-width: 1120px; }
.import { padding: calc(var(--space) * 3); max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: calc(var(--space) * 3); }
h2 { margin-bottom: 0; }
.card { background: var(--surface); border: 1px solid var(--border); padding: calc(var(--space) * 3); border-radius: var(--radius); display: flex; flex-direction: column; gap: calc(var(--space) * 2); }
h3 { margin: 0; font-size: 1rem; }
.dropzone { position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--space); padding: calc(var(--space) * 6) calc(var(--space) * 3); border: 2px dashed var(--border); border-radius: var(--radius); cursor: pointer; text-align: center; }
.dropzone.dragging { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.dropzone input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; clip: rect(0 0 0 0); }
.dropzone:focus-within { border-color: var(--accent); }
.detected { display: grid; grid-template-columns: 1fr 2fr; gap: var(--space) calc(var(--space) * 2); margin: 0; font-size: 0.9rem; }
.detected dt { color: var(--text-muted); }
.detected dd { margin: 0; font-weight: 600; }
.remember { display: flex; align-items: center; gap: var(--space); font-size: 0.85rem; cursor: pointer; }
.field-label { font-size: 0.85rem; color: var(--text-muted); margin-bottom: -8px; }
select, input[type="text"], input[type="number"], input:not([type]) { width: 100%; }
.mapping-saved { display: flex; align-items: center; gap: var(--space); flex-wrap: wrap; font-size: 0.85rem; color: var(--text-muted); }
.mapping-grid { display: grid; grid-template-columns: 1fr 2fr; gap: var(--space) calc(var(--space) * 2); align-items: center; font-size: 0.9rem; }
.save-mapping { display: flex; gap: var(--space); align-items: center; }
.save-mapping input { flex: 1; }
.hint { font-size: 0.85rem; color: var(--text-muted); font-style: italic; }
.btn-row { display: flex; gap: var(--space); justify-content: flex-end; }
.btn-small.active { background: var(--accent); color: var(--accent-text); }
.reconcile-info { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space); }
.reconcile-info p { margin: 0; }
.balance { font-size: 0.9rem; font-weight: 600; }
.balance.ok { color: var(--c-income); }
.balance.warn { color: var(--warning); }
.balance.neutral { color: var(--text-muted); font-weight: 400; }
.mismatches { margin: 0; padding-left: calc(var(--space) * 3); font-size: 0.85rem; color: var(--warning); }
.preview-controls { display: flex; gap: var(--space); }
.preview-table { border: 1px solid var(--border); border-radius: calc(var(--radius) / 1.5); overflow: hidden; }
.preview-row { display: grid; grid-template-columns: var(--cols, 28px 100px 80px 110px 1fr); gap: var(--space); padding: calc(var(--space) * 1.2) calc(var(--space) * 2); align-items: center; font-size: 0.85rem; cursor: pointer; border-bottom: 1px solid var(--border); }
.preview-row:last-child { border-bottom: none; }
.preview-row.header { font-weight: 600; color: var(--text-muted); cursor: default; background: var(--surface-2); }
.preview-row:hover:not(.header) { background: color-mix(in srgb, var(--accent) 7%, transparent); }
.preview-row.selected { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.preview-row.dup { opacity: 0.5; }
.card-step { margin: 0; font-weight: 600; }
.new-card { display: flex; flex-direction: column; gap: var(--space); padding: calc(var(--space) * 2); border: 1px dashed var(--border); border-radius: calc(var(--radius) / 1.5); }
.tag { margin-left: calc(var(--space)); padding: 0 6px; font-size: 0.75rem; border: 1px solid var(--border); border-radius: 999px; color: var(--text-muted); }
.income { color: var(--c-income); }
.expense { color: var(--c-expense); }
.desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history { display: flex; flex-direction: column; gap: var(--space); }
.history-row { display: flex; align-items: center; gap: calc(var(--space) * 2); padding: calc(var(--space) * 1.5) 0; border-bottom: 1px solid var(--border); }
.history-row:last-child { border-bottom: none; }
.history-row.undone { opacity: 0.5; }
.history-info { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 0.9rem; }
.text-error { font-size: 0.9rem; }
.status { font-size: 0.9rem; color: var(--text-muted); }
h4 { margin: 0; font-size: 0.9rem; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.batch-section { display: flex; flex-direction: column; gap: var(--space); }
.batch-section p { margin: 0; }
.batch-group { display: flex; flex-direction: column; gap: var(--space); padding: calc(var(--space) * 2); border: 1px dashed var(--border); border-radius: calc(var(--radius) / 1.5); }
.batch-list { margin: 0; padding-left: calc(var(--space) * 3); font-size: 0.9rem; display: flex; flex-direction: column; gap: 4px; }
.table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: calc(var(--radius) / 1.5); }
.batch-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.batch-table th, .batch-table td { padding: calc(var(--space) * 1.2) calc(var(--space) * 1.5); text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
.batch-table th { font-weight: 600; color: var(--text-muted); background: var(--surface-2); white-space: nowrap; }
.batch-table tbody tr:last-child td { border-bottom: none; }
.batch-table tr.done { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.batch-file { word-break: break-word; }
</style>
