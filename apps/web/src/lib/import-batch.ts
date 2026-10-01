import type { Institution } from "./entity";
import type { DetectResponse, PreviewRow, StatementPreview } from "./import-client";

/**
 * Importação em lote (vários arquivos de uma vez): lógica pura, sem Vue. A tela entrega as funções de rede
 * (detect / preview / commit) e guarda o estado; aqui ficam as regras de agrupamento, ordem e seleção.
 */

export type BatchFormat = "ofx" | "pdf_statement" | "csv_invoice";

/** Só o que o lote precisa saber de uma conta. */
export interface BatchAccount {
  id: string;
  type: string;
  externalId: string | null;
}

/** Um extrato (ou um cartão de uma fatura) a importar. Uma fatura CSV com 2 cartões gera 2 entradas. */
export interface BatchEntry {
  key: string;
  fileIndex: number;
  fileName: string;
  format: BatchFormat;
  /** Fatura de cartão: só importa para conta de cartão. */
  card: boolean;
  institution: Institution | null;
  /** Número da conta ou final do cartão que o arquivo declara. */
  ref: string | null;
  text: string;
  accountId: string | null;
  preview: StatementPreview | null;
  previewError: string | null;
  selected: boolean;
  result: { inserted: number; skipped: number } | null;
}

export interface UnsupportedFile {
  fileName: string;
  reason: string;
}

export interface UnmatchedGroup {
  key: string;
  ref: string | null;
  card: boolean;
  institution: Institution | null;
  fileNames: string[];
  entryKeys: string[];
}

export interface CommitRow {
  type: "income" | "expense";
  amountCents: number;
  date: string;
  postedDate: string | null;
  fingerprint: string;
  description: string | null;
  accountId: string;
  categoryId: string | null;
}

export type PreviewBody = { accountId: string; text: string; format: BatchFormat; cardRef?: string };
export type PreviewFn = (body: PreviewBody) => Promise<StatementPreview>;
export type CommitFn = (batchId: string, rows: CommitRow[]) => Promise<{ inserted: number; skipped: number }>;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function compatibleAccounts<A extends BatchAccount>(card: boolean, accounts: A[]): A[] {
  return accounts.filter((a) => (card ? a.type === "credit_card" : a.type !== "credit_card"));
}

/** Conta casada pelo detect só vale se ainda existir e for do tipo certo (fatura só para cartão). */
function resolveMatched(id: string | null | undefined, card: boolean, accounts: BatchAccount[]): string | null {
  if (!id) return null;
  return compatibleAccounts(card, accounts).some((a) => a.id === id) ? id : null;
}

export function classifyDetected(
  fileName: string,
  fileIndex: number,
  d: DetectResponse,
  accounts: BatchAccount[],
): { entries: BatchEntry[]; unsupported: UnsupportedFile | null } {
  const unsupported = (reason: string) => ({ entries: [], unsupported: { fileName, reason } });
  const base = { fileIndex, fileName, institution: d.institution, preview: null, previewError: null, selected: false, result: null };

  if (d.format === "csv") return unsupported("CSV genérico precisa de mapeamento de colunas.");
  if (d.format === "pdf") return unsupported("PDF de banco não reconhecido: depende de interpretação por IA.");
  if (d.format !== "ofx" && d.format !== "pdf_statement" && d.format !== "csv_invoice") return unsupported("Formato de arquivo não reconhecido.");
  if (!d.text) return unsupported("Não consegui ler o conteúdo do arquivo.");

  if (d.format === "csv_invoice") {
    if (!d.accountRefs.length) return unsupported("Não encontrei cartões neste arquivo.");
    const entries: BatchEntry[] = d.accountRefs.map((ref) => ({
      ...base, key: `${fileIndex}|${ref}`, format: "csv_invoice", card: true, ref, text: d.text as string,
      accountId: resolveMatched(d.matchedAccounts[ref], true, accounts),
    }));
    return { entries, unsupported: null };
  }

  const card = d.kind === "card_invoice";
  return {
    entries: [{
      ...base, key: `${fileIndex}|`, format: d.format, card, ref: d.accountRef, text: d.text,
      accountId: resolveMatched(d.matchedAccountId, card, accounts),
    }],
    unsupported: null,
  };
}

/** Detecta os arquivos um de cada vez (memória e requisições pequenas); um arquivo ruim vira "não suportado". */
export async function detectAll<F extends { name: string }>(
  files: F[],
  detect: (file: F) => Promise<DetectResponse>,
  accounts: BatchAccount[],
  onProgress?: (index: number, total: number) => void,
): Promise<{ entries: BatchEntry[]; unsupported: UnsupportedFile[] }> {
  const entries: BatchEntry[] = [];
  const unsupported: UnsupportedFile[] = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i + 1, files.length);
    try {
      const r = classifyDetected(files[i].name, i, await detect(files[i]), accounts);
      entries.push(...r.entries);
      if (r.unsupported) unsupported.push(r.unsupported);
    } catch (e) {
      unsupported.push({ fileName: files[i].name, reason: `Não consegui ler o arquivo: ${errorMessage(e)}` });
    }
  }
  return { entries, unsupported };
}

/** Entradas que compartilham a mesma conta a escolher: mesma ref (e mesmo tipo), ou o próprio arquivo quando não há ref. */
export function groupKey(e: Pick<BatchEntry, "ref" | "card" | "fileIndex">): string {
  return e.ref ? `${e.card ? "card" : "conta"}:${e.ref}` : `arquivo:${e.fileIndex}`;
}

export function groupUnmatched(entries: BatchEntry[]): UnmatchedGroup[] {
  const groups = new Map<string, UnmatchedGroup>();
  for (const e of entries) {
    if (e.accountId) continue;
    const key = groupKey(e);
    let g = groups.get(key);
    if (!g) {
      g = { key, ref: e.ref, card: e.card, institution: e.institution, fileNames: [], entryKeys: [] };
      groups.set(key, g);
    }
    if (!g.fileNames.includes(e.fileName)) g.fileNames.push(e.fileName);
    g.entryKeys.push(e.key);
  }
  return [...groups.values()];
}

export function assignGroup(entries: BatchEntry[], key: string, accountId: string): BatchEntry[] {
  return entries.map((e) => (!e.accountId && groupKey(e) === key ? { ...e, accountId } : e));
}

/** Mesma regra do fluxo individual: só grava o número na conta se for só dígitos, a conta ainda não tiver um e nenhuma outra o usar. */
export function shouldRemember(ref: string | null, accountId: string, accounts: BatchAccount[]): boolean {
  if (!ref || !/^\d+$/.test(ref)) return false;
  const account = accounts.find((a) => a.id === accountId);
  if (!account || account.externalId) return false;
  return !accounts.some((a) => a.externalId === ref);
}

export type BalanceState = "ok" | "mismatch" | "none";

export function balanceState(p: StatementPreview): BalanceState {
  if (!p.balanceCheck) return "none";
  return p.balanceCheck.ok ? "ok" : "mismatch";
}

export function newRowCount(p: StatementPreview): number {
  return p.rows.filter((r) => !r.dup).length;
}

/** Marcada por padrão: há linha nova e o saldo confere (ou o arquivo não traz saldos). Divergência exige decisão do usuário. */
export function defaultSelected(p: StatementPreview): boolean {
  return newRowCount(p) > 0 && balanceState(p) !== "mismatch";
}

function previewBody(e: BatchEntry): PreviewBody {
  const body: PreviewBody = { accountId: e.accountId as string, text: e.text, format: e.format };
  if (e.format === "csv_invoice" && e.ref) body.cardRef = e.ref;
  return body;
}

/** Pré-visualiza em sequência as entradas que já têm conta e ainda não têm preview. Falha de uma não impede as outras. */
export async function previewPending(
  entries: BatchEntry[],
  preview: PreviewFn,
  onProgress?: (entry: BatchEntry, index: number, total: number) => void,
): Promise<BatchEntry[]> {
  const todo = entries.filter((e) => e.accountId && !e.preview && !e.result);
  const out = new Map<string, BatchEntry>();
  let i = 0;
  for (const e of todo) {
    onProgress?.(e, ++i, todo.length);
    try {
      const p = await preview(previewBody(e));
      out.set(e.key, { ...e, preview: p, previewError: null, selected: defaultSelected(p) });
    } catch (err) {
      out.set(e.key, { ...e, preview: null, previewError: errorMessage(err), selected: false });
    }
  }
  return entries.map((e) => out.get(e.key) ?? e);
}

/** Ordem cronológica pelo início do período; empate pela ordem dos arquivos; sem período vai para o fim. */
export function sortChronologically(entries: BatchEntry[]): BatchEntry[] {
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const fa = a.e.preview?.period?.from ?? null;
      const fb = b.e.preview?.period?.from ?? null;
      if (fa !== fb) {
        if (fa === null) return 1;
        if (fb === null) return -1;
        return fa < fb ? -1 : 1;
      }
      return a.e.fileIndex - b.e.fileIndex || a.i - b.i;
    })
    .map((x) => x.e);
}

function toCommitRow(r: PreviewRow, accountId: string): CommitRow {
  return {
    type: r.type, amountCents: r.amountCents, date: r.date, postedDate: r.postedDate ?? null, fingerprint: r.fingerprint,
    description: r.description, accountId, categoryId: r.categoryId ?? null,
  };
}

/** Linhas enviadas no commit: as que não são duplicadas. */
export function commitRows(e: BatchEntry): CommitRow[] {
  return (e.preview?.rows ?? []).filter((r) => !r.dup).map((r) => toCommitRow(r, e.accountId as string));
}

export interface CommitRun {
  done: Array<{ entry: BatchEntry; inserted: number; skipped: number }>;
  failed: { entry: BatchEntry; message: string } | null;
  /** Marcadas que não foram tentadas porque uma anterior falhou. */
  remaining: BatchEntry[];
}

/** Importa as marcadas em sequência, em ordem cronológica; para na primeira falha. Entradas já importadas são puladas. */
export async function runCommit(
  entries: BatchEntry[],
  commit: CommitFn,
  onProgress?: (entry: BatchEntry, index: number, total: number) => void,
): Promise<CommitRun> {
  const queue = sortChronologically(entries).filter((e) => e.selected && e.preview && e.accountId && !e.result);
  const run: CommitRun = { done: [], failed: null, remaining: [] };
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    onProgress?.(entry, i + 1, queue.length);
    try {
      const r = await commit((entry.preview as StatementPreview).batchId, commitRows(entry));
      run.done.push({ entry, inserted: r.inserted, skipped: r.skipped });
    } catch (e) {
      run.failed = { entry, message: errorMessage(e) };
      run.remaining = queue.slice(i + 1);
      break;
    }
  }
  return run;
}

export function summarize(entries: BatchEntry[]): { files: number; inserted: number; skipped: number } {
  let files = 0;
  let inserted = 0;
  let skipped = 0;
  for (const e of entries) {
    if (!e.result) continue;
    files++;
    inserted += e.result.inserted;
    skipped += e.result.skipped;
  }
  return { files, inserted, skipped };
}
