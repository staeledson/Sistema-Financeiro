import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Sobe a partir de `startDir` até achar `pnpm-workspace.yaml`; funciona tanto em `src/` quanto em `dist/`. */
export function findMonorepoRoot(startDir: string): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`pnpm-workspace.yaml não encontrado acima de ${startDir}`);
    dir = parent;
  }
}
