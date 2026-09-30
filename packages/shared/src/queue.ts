export const AI_QUEUE_NAME = "ai";
export const INGEST_JOB_NAME = "ingest";

export const INGEST_JOB_KINDS = [
  "parse_text",
  "parse_image",
  "parse_audio",
  "parse_invoice",
  "categorize",
  "compute_insights",
] as const;
export type IngestJobKind = (typeof INGEST_JOB_KINDS)[number];

export interface IngestJobData {
  jobId: string;
  workspaceId: string;
  userId: string;
  kind: IngestJobKind;
  text?: string;
  storagePath?: string;
  /** Lote de importação cujo conjunto de transações deve ser categorizado (kind = categorize). */
  batchId?: string;
}
