import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@app/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
  ],
  test: {
    environment: "node",
    hookTimeout: 30000,
    testTimeout: 30000,
    env: { DATABASE_URL: "postgresql://app:app@localhost:5432/financas", REDIS_URL: "redis://localhost:6379" },
    server: { deps: { inline: ["@app/shared"] } },
    // test files share a DB; run serially to avoid cleanDb() race conditions
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
