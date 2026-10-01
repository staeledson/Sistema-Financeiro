import { describe, it, expect } from "vitest";
import { reportableSql } from "../src/insights/reportable";

describe("reportableSql", () => {
  it("exclui pareados e ignorados, com e sem alias de tabela", () => {
    expect(reportableSql().sql.replace(/\s+/g, " ")).toBe('AND "transferPairId" IS NULL AND "ignored" = false');
    expect(reportableSql("t").sql.replace(/\s+/g, " ")).toBe('AND t."transferPairId" IS NULL AND t."ignored" = false');
  });
});
