import { describe, it, expect, afterAll } from "vitest";
import { prisma, cleanDb } from "../helpers/db";
import { auth } from "../../src/auth";

afterAll(async () => {
  await cleanDb();
  await prisma.$disconnect();
});

describe("onboarding", () => {
  it("T1: signup cria 1 workspace pessoal e 1 membership owner", async () => {
    const result = await auth.api.signUpEmail({
      body: {
        email: `test_${Date.now()}@example.com`,
        password: "senha123!",
        name: "Test User",
      },
    });

    expect(result?.user).toBeDefined();
    const userId = result!.user.id;

    const workspaces = await prisma.workspace.findMany({
      where: { createdById: userId },
    });
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0].type).toBe("personal");
    expect(workspaces[0].currency).toBe("BRL");

    const members = await prisma.workspaceMember.findMany({
      where: { userId },
    });
    expect(members).toHaveLength(1);
    expect(members[0].role).toBe("owner");
    expect(members[0].workspaceId).toBe(workspaces[0].id);
  });
});
