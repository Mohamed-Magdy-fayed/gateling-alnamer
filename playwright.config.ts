import { defineConfig, devices } from "@playwright/test";

// Al-Namer ports: dev and start:local 3400, smoke 3410 (3000/3100 are often held by other projects).
const PORT = Number(process.env.SMOKE_PORT ?? 3410);
const baseURL = `http://localhost:${PORT}`;

// The smoke runs on the throwaway test database (`--test-db`); the server is owned and killed
// by Playwright, never left running in a bare shell.
export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/f1-baseline/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/start-local.mjs --test-db",
    url: baseURL,
    reuseExistingServer: false,
    // x-real-ip is trusted only here: each test sets its own address (e2e/helpers/client-ip.ts).
    // Google sign-in uses the local mock in the smoke run, even when .env carries real keys.
    env: {
      PORT: String(PORT),
      TRUST_PROXY_HEADERS: "1",
      OAUTH_FORCE_MOCK: "1",
    },
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
