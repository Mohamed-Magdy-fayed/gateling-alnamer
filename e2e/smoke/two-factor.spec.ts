import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import {
  createStudent,
  FIELD_EMAIL,
  FIELD_PASSWORD,
  password,
  runId,
  SIGN_IN,
  SIGN_OUT,
  signInStaff,
  withDb,
} from "./helpers";

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

test("a passkey added on the account page passes the sign-in challenge", async ({ page }) => {
  // Chromium's virtual authenticator stands in for a fingerprint reader (WebAuthn over CDP).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await signInStaff(page, staffEmail, password);
  await page.goto("/dashboard/account");
  await page.getByRole("button", { name: "إضافة مفتاح مرور" }).click();
  await expect(page.getByText("تمت إضافة مفتاح المرور.")).toBeVisible();

  await page.getByRole("button", { name: SIGN_OUT }).first().click();
  await page.waitForURL(/\/(sign-in)?$/);
  await page.goto("/sign-in");
  await page.getByLabel(FIELD_EMAIL).fill(staffEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL(/\/two-factor/);
  await page.getByRole("button", { name: "استخدام مفتاح المرور" }).click();
  await page.waitForURL("**/dashboard");
});
