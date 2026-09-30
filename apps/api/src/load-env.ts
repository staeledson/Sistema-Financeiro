import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "./find-root";

const monorepoRoot = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)));

for (const file of [".env", ".env.local"]) {
  const path = resolve(monorepoRoot, file);
  if (existsSync(path)) config({ path, override: false });
}
