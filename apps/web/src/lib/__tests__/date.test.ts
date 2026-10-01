import { describe, expect, it } from "vitest";
import { formatDateOnly } from "../date";

describe("formatDateOnly", () => {
  it("lê a data do texto, sem depender do fuso (meia-noite UTC não vira o dia anterior)", () => {
    expect(formatDateOnly("2026-09-01T00:00:00.000Z")).toBe("01/09/2026");
    expect(formatDateOnly("2026-09-01")).toBe("01/09/2026");
    expect(formatDateOnly("2025-12-31T00:00:00.000Z")).toBe("31/12/2025");
  });
});
