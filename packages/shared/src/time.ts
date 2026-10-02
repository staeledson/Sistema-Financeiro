export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: DEFAULT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  }
}

/** Data civil (`YYYY-MM-DD`) de `now` no fuso dado; fuso vazio ou inválido usa o padrão (Brasil). */
export function todayInTimeZone(timeZone: string | undefined = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  const parts = formatter(timeZone?.trim() || DEFAULT_TIME_ZONE).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function monthStartOf(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
