import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMonorepoRoot } from "../../src/find-root";

const base = realpathSync(mkdtempSync(join(tmpdir(), "find-root-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("findMonorepoRoot", () => {
  it("acha a raiz a partir de src/ e de dist/ (profundidades diferentes)", () => {
    const root = join(base, "repo");
    mkdirSync(join(root, "apps/api/src"), { recursive: true });
    mkdirSync(join(root, "apps/api/dist/nested"), { recursive: true });
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    expect(findMonorepoRoot(join(root, "apps/api/src"))).toBe(root);
    expect(findMonorepoRoot(join(root, "apps/api/dist/nested"))).toBe(root);
  });

  it("lança erro quando não há pnpm-workspace.yaml acima", () => {
    const lonely = join(base, "sem-raiz/a/b");
    mkdirSync(lonely, { recursive: true });
    expect(() => findMonorepoRoot(lonely)).toThrow(/pnpm-workspace\.yaml/);
  });
});
