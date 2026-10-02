import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_ZONE, monthStartOf, todayInTimeZone } from "../time";

describe("time", () => {
  it("01:30 UTC ainda é o dia anterior em São Paulo", () => {
    const now = new Date("2026-10-01T01:30:00Z");
    expect(todayInTimeZone("America/Sao_Paulo", now)).toBe("2026-09-30");
    expect(todayInTimeZone("UTC", now)).toBe("2026-10-01");
  });
  it("padrão é São Paulo e fuso inválido cai no padrão", () => {
    const now = new Date("2026-03-01T02:00:00Z");
    expect(todayInTimeZone(undefined, now)).toBe("2026-02-28");
    expect(todayInTimeZone("Marte/Olympus", now)).toBe(todayInTimeZone(DEFAULT_TIME_ZONE, now));
  });
  it("monthStartOf", () => {
    expect(monthStartOf("2026-09-30")).toBe("2026-09-01");
  });
});
