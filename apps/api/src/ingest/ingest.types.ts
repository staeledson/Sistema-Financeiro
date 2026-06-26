export interface IngestJobData {
  jobId: string;
  workspaceId: string;
  userId: string;
  kind: "parse_text" | "parse_image" | "parse_audio";
  text?: string;
  storagePath?: string;
}
