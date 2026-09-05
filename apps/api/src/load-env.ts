import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

for (const file of [".env", ".env.local"]) {
  const path = resolve(monorepoRoot, file);
  if (existsSync(path)) config({ path, override: false });
}
