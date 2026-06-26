type Cat = { id: string; name: string; type: string };

export function mapCategory(
  name: string | null | undefined,
  type: string,
  cats: Cat[],
): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const hit = cats.find((c) => c.type === type && c.name.trim().toLowerCase() === n);
  return hit?.id ?? null;
}
