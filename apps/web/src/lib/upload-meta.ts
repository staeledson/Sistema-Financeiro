const EXT_RE = /^[a-z0-9]{1,8}$/;
const TYPE_RE = /^(image|audio|application)\/[\w.+-]{1,60}$/;

/** Extensão e tipo MIME aceitos pela API para um arquivo escolhido; sem dado confiável, assume JPEG. */
export function imageUploadMeta(file: { name: string; type: string }): { ext: string; contentType: string } {
  const dot = file.name.lastIndexOf(".");
  const rawExt = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const ext = EXT_RE.test(rawExt) ? rawExt : "jpg";
  const contentType = TYPE_RE.test(file.type) ? file.type : "image/jpeg";
  return { ext, contentType };
}
