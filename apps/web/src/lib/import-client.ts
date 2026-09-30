import { http } from "./http";
import type { Institution } from "./entity";

export type DetectedFormat = "ofx" | "pdf_statement" | "csv" | "pdf" | "unknown";

export interface DetectResponse {
  format: DetectedFormat;
  institution: Institution | null;
  kind: "statement" | "card_invoice" | null;
  accountRef: string | null;
  confidence: number;
  matchedAccountId: string | null;
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

export function previewStatement(body: { accountId: string; text: string; format: "ofx" | "pdf_statement" }) {
  return http<StatementPreview>("POST", "/import/preview", body);
}

export function undoBatch(batchId: string) {
  return http<{ removed: number }>("POST", `/import/${batchId}/undo`, {});
}

export function listBatches() {
  return http<BatchSummary[]>("GET", "/import/batches");
}
