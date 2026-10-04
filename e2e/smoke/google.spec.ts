import { expect, type Page, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, markEmailVerified, password, pickDate, runId } from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const GOOGLE = "المتابعة باستخدام Google";

/** Sign-in page -> "Continue with Google" -> the local mock consent page -> back to the app. */
async function googleAs(page: Page, email: string, name: string) {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: GOOGLE }).click();
  await page.waitForURL("**/dev/oauth/google**");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("الاسم").fill(name);
  await page.getByRole("button", { name: "متابعة", exact: true }).click();
}

test("a new Google user completes sign-up as a student and lands on the dashboard", async ({
  page,
}) => {
  await googleAs(page, `smoke-google-new-${runId}@alnamer.local`, "Smoke Googler");
  await page.waitForURL("**/sign-up/google");
  await expect(page.getByText(`smoke-google-new-${runId}@alnamer.local`)).toBeVisible();
  await pickDate(page, 25, 4, 14);
  await page.getByRole("button", { name: "إنشاء حسابي" }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Smoke Googler");
});

test("an existing verified student signs in with Google without a new account", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = `smoke-google-old-${runId}@alnamer.local`;
  await createStudent(browser, baseURL, { name: "Smoke Linked", email, password });
  await markEmailVerified(email);
  await googleAs(page, email, "Someone Else");
  await page.waitForURL("**/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Smoke Linked");
});

test("an unverified local account is not linked; the person signs in with the password", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = `smoke-google-unverified-${runId}@alnamer.local`;
  await createStudent(browser, baseURL, { name: "Smoke Unverified", email, password });
  await googleAs(page, email, "Attacker");
  await page.waitForURL("**/sign-in?notice=google-password");
  await expect(page.getByText(/سجّل الدخول بكلمة المرور أولًا/)).toBeVisible();
});
