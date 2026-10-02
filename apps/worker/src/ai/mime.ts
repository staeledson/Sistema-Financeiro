const IMAGE: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", heif: "image/heif" };
const AUDIO: Record<string, string> = { webm: "audio/webm", m4a: "audio/mp4", mp4: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };

/** Tipo MIME pela extensão da chave S3; sem extensão conhecida usa o padrão do navegador (jpeg / webm). */
export function mimeFromPath(storagePath: string, kind: "image" | "audio"): string {
  const ext = storagePath.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "image") return IMAGE[ext] ?? "image/jpeg";
  return AUDIO[ext] ?? "audio/webm";
}
