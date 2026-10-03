import { test } from "@playwright/test";

// The auth limits are keyed on the client IP and the local Redis outlives a run. Off Vercel the IP
// comes from x-real-ip (trusted via TRUST_PROXY_HEADERS=1 in playwright.config.ts), so each test gets its own address and a rerun within the hour never starts
// with a spent sign-up budget.
const now = Date.now();
const runOctets = [Math.floor(now / 60_000) % 250, Math.floor(now / 1000) % 250];
let next = 0;

export function uniqueClientIpPerTest(): void {
  test.beforeEach(async ({ context }) => {
    next += 1;
    await context.setExtraHTTPHeaders({
      "x-real-ip": `10.${runOctets[0]}.${runOctets[1]}.${next}`,
    });
  });
}

/** A fresh address for a context a test opens itself (`browser.newContext`), from the same counter. */
export function nextClientIp(): string {
  next += 1;
  return `10.${runOctets[0]}.${runOctets[1]}.${next}`;
}
