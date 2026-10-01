import { http } from "./http";
import type { Institution } from "./entity";
import { formatDateOnly } from "./date";

export type DetectedFormat = "ofx" | "pdf_statement" | "csv_invoice" | "csv" | "pdf" | "unknown";

export interface DetectResponse {
  format: DetectedFormat;
  institution: Institution | null;
  kind: "statement" | "card_invoice" | null;
  accountRef: string | null;
  confidence: number;
  matchedAccountId: string | null;
  /** Finais de cartão distintos de uma fatura (vazio nos demais formatos). */
  accountRefs: string[];
  /** Por final de cartão: id da conta de cartão que casa por externalId, ou null. */
  matchedAccounts: Record<string, string | null>;
  text: string | null;
}

export interface BalanceMismatch {
  dateISO: string;
  expectedCents: number;
  computedCents: number;
  diffCents: number;
}

export interface BalanceCheck {
  ok: boolean;
  checkedAt: string;
  checkpoints: number;
  mismatches: BalanceMismatch[];
}

export interface PreviewRow {
  type: "income" | "expense";
  amountCents: number;
  date: string;
  postedDate?: string | null;
  description: string | null;
  fingerprint: string;
  accountId?: string;
  dup: boolean;
  /** Categoria nossa sugerida a partir da categoria do banco (fatura). */
  categoryId?: string | null;
  /** Categoria como veio no arquivo do banco (fatura). */
  bankCategory?: string | null;
}

/** Saldo que o próprio extrato declara; só vem preenchido quando é o saldo corrente (de hoje). */
export interface StatementBalance {
  dateISO: string;
  balanceCents: number;
  current: boolean;
}

export interface StatementPreview {
  batchId: string;
  institution: Institution | null;
  accountRef: string | null;
  period: { from: string; to: string } | null;
  rows: PreviewRow[];
  rowCount: number;
  dupCount: number;
  balanceCheck: BalanceCheck | null;
  statementBalance?: StatementBalance | null;
  /** A conta tem lançamento depois da data de `statementBalance`: o saldo do extrato já não é o de hoje. */
  laterActivity?: boolean;
}

export interface BatchSummary {
  id: string;
  format: string;
  institution: Institution | null;
  accountName: string | null;
  rowCount: number;
  dupCount: number;
  inserted: number;
  balanceOk: boolean | null;
  createdAt: string;
  undoneAt: string | null;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("falha ao ler o arquivo"));
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  if (!utf8.includes("\uFFFD")) return utf8;
  return new TextDecoder("windows-1252").decode(bytes);
}

export function readFileBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("falha ao ler o arquivo"));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

export function formatDate(iso: string): string {
  // "YYYY-MM-DD" puro vira UTC à meia-noite em new Date(); em UTC-3 mostraria o dia anterior.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return formatDateOnly(iso);
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function balanceSummary(check: BalanceCheck | null): { tone: "neutral" | "ok" | "warn"; text: string } {
  if (!check) return { tone: "neutral", text: "O arquivo não traz saldos para conferir." };
  if (check.ok) {
    const n = check.checkpoints;
    return { tone: "ok", text: `Saldos conferem em ${n} ${n === 1 ? "ponto" : "pontos"}.` };
  }
  const m = check.mismatches.length;
  return {
    tone: "warn",
    text: `${m} ${m === 1 ? "divergência" : "divergências"} de saldo em ${check.checkpoints} pontos conferidos.`,
  };
}

export async function detectFile(file: File): Promise<DetectResponse> {
  return http<DetectResponse>("POST", "/import/detect", {
    fileName: file.name,
    contentBase64: await fileToBase64(file),
  });
}

export function previewStatement(body: {
  accountId: string;
  text: string;
  format: "ofx" | "pdf_statement" | "csv_invoice";
  cardRef?: string;
}) {
  return http<StatementPreview>("POST", "/import/preview", body);
}

export function undoBatch(batchId: string) {
  return http<{ removed: number }>("POST", `/import/${batchId}/undo`, {});
}

export function listBatches() {
  return http<BatchSummary[]>("GET", "/import/batches");
}

/** Próximo final de cartão do arquivo que ainda não foi importado; null quando acabou. */
export function nextCardRef(accountRefs: string[], doneRefs: string[]): string | null {
  return accountRefs.find((r) => !doneRefs.includes(r)) ?? null;
}

/** Parcela ("3/10") e compra em dólar, lidas dos sufixos que o parser põe na descrição da fatura. */
export function rowTags(description: string | null): { installment: string | null; usd: boolean } {
  const text = description ?? "";
  const usd = /\(US\$ [\d.,]+ @ [\d.,]+\)$/.test(text);
  const base = usd ? text.replace(/\s*\(US\$ [\d.,]+ @ [\d.,]+\)$/, "") : text;
  const m = /\s(\d{1,3}\/\d{1,3})$/.exec(base);
  return { installment: m ? m[1] : null, usd };
}

/** Confirma no banco as linhas escolhidas de um preview (mesma chamada do fluxo individual). */
export function commitImport(batchId: string, rows: unknown[]) {
  return http<{ inserted: number; skipped: number }>("POST", `/import/${batchId}/commit`, { rows });
}
