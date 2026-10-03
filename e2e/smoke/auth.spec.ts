import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import {
  CAPTCHA_FAILED,
  CONSENT,
  CREDENTIALS_ERROR,
  email,
  FIELD_EMAIL,
  FIELD_IDENTIFIER,
  FIELD_NAME,
  FIELD_PASSWORD,
  FIELD_USERNAME,
  finishSignUp,
  LINK_PARENT,
  LOCKOUT,
  minorEmail,
  PARENT_ROLE,
  password,
  pickDate,
  runId,
  SHOW_PASSWORD,
  SIGN_IN,
  SIGN_OUT,
  SIGN_UP,
  signIn,
  startParentSignUp,
  username,
} from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

test("sign-up an adult student with a username, sign out, sign in with the username", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Smoke Student");
  await page.getByLabel(FIELD_EMAIL).fill(email);
  await page.getByLabel(FIELD_USERNAME).fill(username);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 25, 4, 14);
  await expect(page.getByLabel(CONSENT)).toHaveCount(0);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await finishSignUp(page);
  await expect(page.getByText(LINK_PARENT)).toHaveCount(0);

  await page.getByRole("button", { name: SIGN_OUT }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await page.goto("/sign-in");
  await page.getByLabel(FIELD_IDENTIFIER).fill(username.toUpperCase());
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL("**/dashboard");
  await page.getByRole("button", { name: SIGN_OUT }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await signIn(page, email, password);
});

test("10 wrong passwords lock sign-in for that device and the message shows a time", async ({
  page,
}) => {
  const lockEmail = `smoke-lock-${runId}@alnamer.local`;
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Smoke Lockout");
  await page.getByLabel(FIELD_EMAIL).fill(lockEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 25, 4, 14);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await finishSignUp(page);
  await page.getByRole("button", { name: SIGN_OUT }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await page.goto("/sign-in");
  const alert = page.locator('[data-slot="alert"]');
  // The first attempt only sets the device cookie's pair; the lockout lands within a dozen tries.
  for (let attempt = 1; attempt <= 12; attempt++) {
    await page.getByLabel(FIELD_IDENTIFIER).fill(lockEmail);
    await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(`wrong-pass-${attempt}`);
    await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
    await expect(alert).toBeFocused();
    if ((await alert.innerText()).includes(LOCKOUT)) break;
  }
  await expect(alert).toContainText(LOCKOUT);
  await expect(alert).toContainText(/\d{1,2}:\d{2}/);
  await expect(page.getByRole("button", { name: SIGN_IN, exact: true })).toBeDisabled();
});

test("an under-18 student needs the consent tick, then the dashboard asks to link a parent", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Smoke Minor");
  await page.getByLabel(FIELD_EMAIL).fill(minorEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 12, 2, 9);
  const consent = page.getByLabel(CONSENT);
  await expect(consent).toBeVisible();

  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await expect(page).toHaveURL(/\/sign-up/);
  await expect(consent).toHaveAttribute("aria-invalid", "true");

  // A failed submit keeps the other fields but clears the password.
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await consent.check();
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await finishSignUp(page);
  await expect(page.getByText(LINK_PARENT)).toBeVisible();
});

test("a duplicate email gets one generic error and a forgot-password link", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Someone Else");
  await page.getByLabel(FIELD_EMAIL).fill(email);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 30, 1, 3);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  const alert = page.locator('[data-slot="alert"]').first();
  await expect(alert).toContainText("تحقق من بياناتك");
  await expect(alert.getByRole("link", { name: "نسيت كلمة المرور؟" })).toBeVisible();
});

test("a failed sign-up submit focuses the error summary, which links to the failing fields", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  const summary = page.locator('[data-slot="alert"]').first();
  await expect(summary).toBeFocused();
  await summary.getByRole("link").first().click();
  await expect(page.getByLabel(FIELD_NAME)).toBeFocused();
});

test("a forced failing captcha token shows the captcha copy and creates no user", async ({
  page,
}) => {
  const captchaEmail = `smoke-captcha-${runId}@alnamer.local`;
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Smoke Captcha");
  await page.getByLabel(FIELD_EMAIL).fill(captchaEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 25, 4, 14);
  // The fake provider's widget is a hidden field; the test hook is to make its value the fail token.
  await page.locator('input[name="captcha_token"]').evaluate((input: HTMLInputElement) => {
    input.value = "fail";
  });
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  const alert = page.locator('[data-slot="alert"]').first();
  await expect(alert).toBeFocused();
  await expect(alert).toContainText(CAPTCHA_FAILED);
  await expect(page).toHaveURL(/[/]sign-up/);

  await page.goto("/sign-in");
  await page.getByLabel(FIELD_IDENTIFIER).fill(captchaEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await expect(page.locator('[data-slot="alert"]')).toContainText(CREDENTIALS_ERROR);
});

test("a failed sign-in focuses the error alert", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel(FIELD_IDENTIFIER).fill("nobody@alnamer.local");
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill("wrong-pass-1");
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await expect(page.locator('[data-slot="alert"]')).toBeFocused();
});

test("a failed parent submit keeps Parent selected and shows no consent box", async ({ page }) => {
  await startParentSignUp(page);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await expect(page).toHaveURL(/[/]sign-up/);
  await expect(page.getByRole("radio", { name: PARENT_ROLE })).toBeChecked();
  await expect(page.getByLabel(CONSENT)).toHaveCount(0);
});

test("the password toggle keeps one name and exposes aria-pressed", async ({ page }) => {
  await page.goto("/sign-in");
  const toggle = page.getByRole("button", { name: SHOW_PASSWORD });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.getByRole("button", { name: SHOW_PASSWORD })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel(FIELD_PASSWORD, { exact: true })).toHaveAttribute("type", "text");
});
