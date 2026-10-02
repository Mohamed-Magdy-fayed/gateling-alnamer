import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run against the local db-test container (`npm run db:up`).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Fixed root secret so keyed hashes are deterministic and no per-process fallback warning fires.
    env: { AUTH_SECRET: "vitest-auth-secret-0123456789abcdef-vitest" },
    include: ["src/**/*.int.test.ts", "scripts/**/*.int.test.mjs"],
    globalSetup: ["test/int/global-setup.ts"],
    setupFiles: ["test/int/setup.ts"],
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
