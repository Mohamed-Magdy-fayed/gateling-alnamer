import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, password, runId, SIGN_OUT, signInStaff, withDb } from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const staffEmail = `smoke-2fa-${runId}@alnamer.local`;

test.beforeAll(async ({ browser, baseURL }) => {
  await createStudent(browser, baseURL, { name: "Smoke Reviewer", email: staffEmail, password });
  await withDb(async (sql) => {
    await sql`update users set role = 'reviewer', email_verified_at = now() where email = ${staffEmail}`;
  });
});

test("staff enrol on first sign-in, then pass the challenge on the next one", async ({ page }) => {
  // First sign-in: enrolment (setup page, first code, recovery codes, finish).
  await signInStaff(page, staffEmail, password);
  await expect(page.locator("h1").first()).toBeVisible();

  // An unverified session sees no app page: sign out, sign in again, and the dashboard waits
  // behind the challenge.
  await page.getByRole("button", { name: SIGN_OUT }).click();
  await page.waitForURL(/\/(sign-in)?$/);
  await signInStaff(page, staffEmail, password);
  await page.goto("/dashboard/account");
  await expect(page.getByRole("heading", { name: "التحقق بخطوتين" })).toBeVisible();
});
