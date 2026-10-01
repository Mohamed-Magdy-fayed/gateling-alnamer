import { defineConfig, devices } from "@playwright/test";

// Not 3000: that port is often held by a dev server.
const PORT = Number(process.env.SMOKE_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// The smoke runs on the throwaway test database (`--test-db`); the server is owned and killed
// by Playwright, never left running in a bare shell.
export default defineConfig({
  testDir: "./e2e",
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
    env: { PORT: String(PORT) },
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
