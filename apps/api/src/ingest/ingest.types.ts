export type IngestJobKind = "parse_text" | "parse_image" | "parse_audio" | "parse_invoice" | "categorize" | "compute_insights";

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
