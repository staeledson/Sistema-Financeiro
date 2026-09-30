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
});
