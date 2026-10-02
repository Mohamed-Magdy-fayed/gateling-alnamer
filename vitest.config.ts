import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

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
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: [...configDefaults.exclude, "**/*.int.test.*"],
  },
});
