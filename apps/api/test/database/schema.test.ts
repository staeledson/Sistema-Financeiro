import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "../helpers/db";

afterAll(async () => { await prisma.$disconnect(); });

describe("schema base", () => {
  it("workspaces existe", async () => {
    const count = await prisma.workspace.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("workspace_members existe", async () => {
    const count = await prisma.workspaceMember.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("bank_accounts tem as colunas do modelo PF/PJ", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'bank_accounts'`;
    const cols = rows.map((r) => r.column_name);
    for (const c of ["entity", "institution", "externalId", "closingDay", "dueDay", "creditLimitCents"]) {
      expect(cols).toContain(c);
    }
  });

  it("categories tem entity e workspace_settings existe", async () => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'categories'`;
    expect(rows.map((r) => r.column_name)).toContain("entity");
    expect(await prisma.workspaceSettings.count()).toBeGreaterThanOrEqual(0);
  });

  it("import_batches e transactions têm as colunas da fase 11", async () => {
    const cols = async (table: string) =>
      (await prisma.$queryRaw<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = ${table}`).map((r) => r.column_name);

    const batch = await cols("import_batches");
    for (const c of ["institution", "detectedAccountRef", "balanceCheck", "undoneAt"]) expect(batch).toContain(c);
    expect(await cols("transactions")).toContain("postedDate");
  });

  it("ImportFormat aceita pdf_statement", async () => {
    const rows = await prisma.$queryRaw<{ v: string }[]>`
      select unnest(enum_range(null::"ImportFormat"))::text as v`;
    expect(rows.map((r) => r.v)).toContain("pdf_statement");
  });

  it("transactions e category_rules têm as colunas da fase 12", async () => {
    const cols = async (table: string) =>
      (await prisma.$queryRaw<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = ${table}`).map((r) => r.column_name);

    const tx = await cols("transactions");
    for (const c of ["categorySource", "categoryConfidence", "reviewStatus", "suggestedCategoryId", "transferPairId", "ignored"]) {
      expect(tx).toContain(c);
    }
    expect(await cols("category_rules")).toContain("hitCount");
  });

  it("transactions tem as colunas de parcela da fase 13", async () => {
    const cols = (await prisma.$queryRaw<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'transactions'`).map((r) => r.column_name);
    expect(cols).toContain("installmentCurrent");
    expect(cols).toContain("installmentTotal");
  });

  it("enums CategorySource e ReviewStatus têm os valores da spec", async () => {
    const values = async (type: "CategorySource" | "ReviewStatus") =>
      (await prisma.$queryRawUnsafe<{ v: string }[]>(`select unnest(enum_range(null::"${type}"))::text as v`)).map((r) => r.v);
    expect(await values("CategorySource")).toEqual(["manual", "rule", "ai", "import", "none"]);
    expect(await values("ReviewStatus")).toEqual(["ok", "pending"]);
  });
});
