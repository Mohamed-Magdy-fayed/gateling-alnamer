import { expect, test } from "@playwright/test";
import { nextClientIp, uniqueClientIpPerTest } from "../helpers/client-ip";
import { countMail, extractCode, waitForMailText } from "../helpers/mailpit";
import {
  BANNER,
  BANNER_ACTION,
  CODE_INVALID,
  CODE_SENT,
  CONTINUE,
  createStudent,
  EMAIL_DELAYED,
  END_SESSION,
  FIELD_CODE,
  FIELD_EMAIL,
  FIELD_NAME,
  FIELD_NEW_PASSWORD,
  FIELD_PASSWORD,
  newPassword,
  password,
  pickDate,
  RESEND,
  recoveryEmail,
  runId,
  SAVE_PASSWORD,
  SEND_CODE,
  SESSION_ENDED,
  SIGN_UP,
  signIn,
  VERIFIED,
  VERIFIED_TITLE,
  VERIFY,
  VERIFY_TITLE,
  verifyEmail,
} from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

test.beforeAll(async ({ browser, baseURL }) => {
  await createStudent(browser, baseURL, {
    name: "Smoke Recovery",
    email: recoveryEmail,
    password,
  });
});

test("sign-up -> Mailpit code -> /verify-email -> verified, and the banner goes away", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Smoke Verify");
  await page.getByLabel(FIELD_EMAIL).fill(verifyEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 25, 4, 14);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await page.waitForURL("**/verify-email");
  const code = extractCode(await waitForMailText(verifyEmail));

  // The code field is a one-time-code numeric LTR input; resend waits out its cooldown.
  const field = page.getByLabel(FIELD_CODE, { exact: true });
  await expect(field).toHaveAttribute("autocomplete", "one-time-code");
  await expect(field).toHaveAttribute("inputmode", "numeric");
  await expect(field).toHaveAttribute("maxlength", "6");
  await expect(field).toHaveAttribute("dir", "ltr");
  await expect(page.getByRole("button", { name: RESEND })).toBeDisabled();
  await expect(page.getByText(/\d:\d{2}/)).toBeVisible();

  const wrong = code === "000000" ? "111111" : "000000";
  await field.fill(wrong);
  await page.getByRole("button", { name: VERIFY, exact: true }).click();
  await expect(page.locator('[data-slot="alert"]', { hasText: CODE_INVALID })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText(BANNER)).toBeVisible();
  await expect(page.locator("bdi", { hasText: verifyEmail })).toBeVisible();
  await page.getByRole("link", { name: BANNER_ACTION }).click();
  await page.waitForURL("**/verify-email");

  await page.getByLabel(FIELD_CODE, { exact: true }).fill(code);
  await expect(page.getByRole("heading", { level: 1, name: VERIFY_TITLE })).toBeVisible();
  await page.getByRole("button", { name: VERIFY, exact: true }).click();
  // The verified Alert takes focus and the page heading switches to the verified state.
  const verifiedAlert = page.locator('[data-slot="alert"]', { hasText: VERIFIED });
  await expect(verifiedAlert).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: VERIFIED_TITLE })).toBeVisible();
  await page.getByRole("link", { name: CONTINUE }).click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByText(BANNER)).toHaveCount(0);

  // Once verified, /verify-email only confirms it.
  await page.goto("/verify-email");
  await expect(page.getByText(VERIFIED)).toBeVisible();
});

test("a failed or slow code email shows the delayed state with a resend button", async ({
  page,
}) => {
  const delayedEmail = `smoke-delayed-${runId}@alnamer.local`;
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Smoke Delayed");
  await page.getByLabel(FIELD_EMAIL).fill(delayedEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 25, 4, 14);
  await page.route("**/api/trpc/auth.codeStatus*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ result: { data: { json: { status: "failed", canResendAt: 0 } } } }]),
    }),
  );
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await page.waitForURL("**/verify-email");
  await expect(page.getByText(EMAIL_DELAYED)).toBeVisible();
  // A delay is a warning, announced politely (role=status), not an error (role=alert).
  await expect(page.getByRole("status").filter({ hasText: EMAIL_DELAYED })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: EMAIL_DELAYED })).toHaveCount(0);
  await expect(page.getByRole("button", { name: RESEND })).toBeEnabled();
});

test("forgot password: wrong code, Mailpit code, reset signs out other sessions, new password works", async ({
  page,
  browser,
  baseURL,
}) => {
  // A second browser holds a live session for the same account.
  const octet = () => Math.floor(Math.random() * 250);
  const other = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": `10.${octet()}.${octet()}.201` },
  });
  const otherPage = await other.newPage();
  await signIn(otherPage, recoveryEmail, password);

  const before = await countMail(recoveryEmail);
  await page.goto("/forgot-password");
  await page.getByLabel(FIELD_EMAIL).fill(recoveryEmail);
  await page.getByRole("button", { name: SEND_CODE }).click();
  await page.waitForURL("**/reset-password");
  expect(page.url()).not.toContain("alnamer.local");
  await expect(page.getByText(CODE_SENT)).toBeVisible();
  await expect(page.getByLabel(FIELD_EMAIL)).toHaveCount(0);
  await expect(page.getByLabel(FIELD_CODE, { exact: true })).toBeFocused();
  const code = extractCode(await waitForMailText(recoveryEmail, { after: before }));

  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByLabel(FIELD_CODE, { exact: true }).fill(wrong);
  await page.getByLabel(FIELD_NEW_PASSWORD).fill(newPassword);
  await page.getByRole("button", { name: SAVE_PASSWORD }).click();
  await expect(page.locator('[data-slot="alert"]', { hasText: CODE_INVALID })).toBeVisible();

  await page.getByLabel(FIELD_CODE, { exact: true }).fill(code);
  await page.getByLabel(FIELD_NEW_PASSWORD).fill(newPassword);
  await page.getByRole("button", { name: SAVE_PASSWORD }).click();
  await expect(page.getByRole("link", { name: "تسجيل الدخول" })).toBeVisible();

  await otherPage.goto("/dashboard");
  await expect(otherPage).toHaveURL(/[/]sign-in/);
  await other.close();

  await signIn(page, recoveryEmail, newPassword);
});

test("after ending another session focus lands on the section heading, never body", async ({
  browser,
  baseURL,
  page,
}) => {
  const other = `smoke-revoke-${runId}@alnamer.local`;
  await createStudent(browser, baseURL, { name: "Smoke Revoke", email: other, password });
  await signIn(page, other, password);
  const second = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": nextClientIp() },
  });
  try {
    await signIn(await second.newPage(), other, password);
  } finally {
    await second.close();
  }
  await page.goto("/dashboard/account");
  const section = page.locator("section[aria-labelledby='account-sessions']");
  await section.getByRole("button", { name: END_SESSION }).first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: END_SESSION }).click();
  await expect(page.getByText(SESSION_ENDED)).toBeVisible();
  // Success moves focus to the section heading (the dialog's own focus return must not win).
  await expect(page.locator("#account-sessions")).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("BODY");
});
