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
});
