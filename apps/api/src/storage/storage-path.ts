import { BadRequestException } from "@nestjs/common";

/** Chave S3 gerada por `IngestService.getUploadUrl`: `${workspaceId}/${uuid}.${ext}`. */
export function belongsToWorkspace(storagePath: string, workspaceId: string): boolean {
  if (!storagePath || storagePath.startsWith("/") || storagePath.includes("..") || storagePath.includes("//")) return false;
  const prefix = `${workspaceId}/`;
  return storagePath.startsWith(prefix) && storagePath.length > prefix.length;
}

export function assertWorkspacePath(storagePath: string, workspaceId: string): void {
  if (!belongsToWorkspace(storagePath, workspaceId)) throw new BadRequestException("arquivo não pertence a este workspace");
}
