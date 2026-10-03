import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import { extractCode, waitForMailText } from "../helpers/mailpit";
import {
  ADD_CHILD,
  CANCEL,
  CANNOT_PLAY,
  CARDS_TITLE,
  createStudent,
  DOB_YEAR,
  FIELD_CHILD_USERNAME,
  FIELD_CODE,
  FIELD_NAME,
  FIELD_PASSWORD,
  INVITE_ACTIVE_TITLE,
  INVITE_COPIED,
  INVITE_COPY,
  INVITE_CREATE,
  LINK_INVALID,
  LINK_LABEL,
  LINK_PARENT,
  LINK_SUBMIT,
  LINKED,
  PARENT_AGE_ERROR,
  PARENT_EMPTY,
  PROGRESS_PLACEHOLDER,
  parentEmail,
  password,
  pickDate,
  RESET_ACTION,
  RESET_DIRECT,
  RESET_DONE,
  redeemEmail,
  runId,
  SIGN_OUT,
  SIGN_UP,
  signInAs,
  startParentSignUp,
  UNLINK,
  VERIFIED_TITLE,
  VERIFY,
} from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

test.beforeAll(async ({ browser, baseURL }) => {
  await createStudent(browser, baseURL, { name: "Smoke Student", email: redeemEmail, password });
});

test("a parent under 18 is refused with the age message", async ({ page }) => {
  await startParentSignUp(page);
  await pickDate(page, 12, 2, 9);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await expect(page).toHaveURL(/[/]sign-up/);
  await expect(page.locator("#field-date_of_birth-error")).toHaveText(PARENT_AGE_ERROR);
});

test("a parent needs a date of birth, then signs up as an adult", async ({ page }) => {
  await startParentSignUp(page);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await expect(page).toHaveURL(/[/]sign-up/);
  await expect(page.getByRole("combobox", { name: DOB_YEAR })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await startParentSignUp(page);
  await pickDate(page, 35, 2, 9);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  // Parent actions need a verified email: confirm it with the Mailpit code.
  await page.waitForURL("**/verify-email");
  const code = extractCode(await waitForMailText(parentEmail));
  await page.getByLabel(FIELD_CODE, { exact: true }).fill(code);
  await page.getByRole("button", { name: VERIFY, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: VERIFIED_TITLE })).toBeVisible();
  await page.goto("/dashboard");
});

const childUsername = `kid_${runId}`;
const childPassword = "Kid-pass-1";
const childNewPassword = "Kid-pass-2";
const childName = "Smoke Child";

test("a parent creates a child, signs out, and the child signs in with the username", async ({
  page,
}) => {
  await signInAs(page, parentEmail, password);
  await expect(page.getByRole("heading", { name: CARDS_TITLE })).toBeVisible();
  await expect(page.getByText(PARENT_EMPTY)).toBeVisible();

  await page.getByRole("button", { name: ADD_CHILD }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel(FIELD_NAME).fill(childName);
  await sheet.getByLabel(FIELD_CHILD_USERNAME, { exact: true }).fill(childUsername);
  await sheet.getByLabel(FIELD_PASSWORD, { exact: true }).fill(childPassword);
  await pickDate(page, 10, 3, 5);
  await sheet.getByRole("button", { name: ADD_CHILD }).click();

  const card = page.getByRole("region", { name: childName });
  await expect(card).toBeVisible();
  await expect(card).toContainText(childUsername);
  await expect(card).toContainText("10 سنوات");
  await expect(card).toContainText(PROGRESS_PLACEHOLDER);
  await expect(card.locator('[dir="ltr"]').filter({ hasText: childUsername })).toHaveCount(1);
  await expect(page.getByText(PARENT_EMPTY)).toHaveCount(0);

  // A created child's password is set directly by the parent; only an admin can remove that link.
  await expect(card.getByRole("button", { name: UNLINK })).toHaveCount(0);
  await card.getByRole("button", { name: RESET_ACTION }).click();
  // The dialog names the child it acts on, and focus starts in the password field.
  const reset = page.getByRole("alertdialog", {
    name: new RegExp(`${RESET_ACTION}.*${childName}`),
  });
  await expect(reset).toBeVisible();
  await expect(reset.getByLabel(RESET_DIRECT)).toBeFocused();
  await reset.getByLabel(RESET_DIRECT).fill(childNewPassword);
  await reset.getByRole("button", { name: RESET_DIRECT }).click();
  await expect(reset.getByText(RESET_DONE)).toBeVisible();

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: SIGN_OUT }).click();
  await page.waitForURL((url) => url.pathname === "/");

  await signInAs(page, childUsername, childNewPassword);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(childName);
  await expect(page.getByText(LINK_PARENT)).toHaveCount(0);
});

test("a parent issues a code, an existing student redeems it, and the card appears", async ({
  page,
  browser,
  baseURL,
}) => {
  await signInAs(page, parentEmail, password);
  await page.getByRole("button", { name: INVITE_CREATE }).click();
  const shown = page.getByTestId("invite-code");
  await expect(shown).toBeVisible();
  await expect(shown).toHaveText(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const code = (await shown.innerText()).trim();
  // The active list shows expiry only, never the code.
  await expect(page.getByRole("region", { name: INVITE_ACTIVE_TITLE })).not.toContainText(code);
  await page.getByRole("button", { name: INVITE_COPY }).click();
  await expect(page.getByText(INVITE_COPIED).first()).toBeVisible();

  const octet = () => Math.floor(Math.random() * 250);
  const other = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": `10.${octet()}.${octet()}.202` },
  });
  const studentPage = await other.newPage();
  await signInAs(studentPage, redeemEmail, password);
  await studentPage.goto("/dashboard/link-parent");

  // A wrong code gives the one generic message.
  await studentPage.getByLabel(LINK_LABEL).fill("AAAA-AAAA");
  await studentPage.getByRole("button", { name: LINK_SUBMIT }).click();
  await expect(studentPage.getByText(LINK_INVALID)).toBeVisible();

  // Lower case and spaces are accepted and shown as XXXX-XXXX.
  await studentPage
    .getByLabel(LINK_LABEL)
    .fill(`${code.slice(0, 4)} ${code.slice(5)}`.toLowerCase());
  await expect(studentPage.getByLabel(LINK_LABEL)).toHaveValue(code);
  await studentPage.getByRole("button", { name: LINK_SUBMIT }).click();
  await expect(studentPage.getByText(LINKED)).toBeVisible();
  await expect(studentPage.getByRole("region", { name: "Smoke Parent" })).toBeVisible();
  await other.close();

  await page.reload();
  const card = page.getByRole("region", { name: "Smoke Student" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: UNLINK }).click();
  const unlinkDialog = page.getByRole("alertdialog", {
    name: new RegExp(`${UNLINK}.*Smoke Student`),
  });
  await expect(unlinkDialog).toBeVisible();
  await unlinkDialog.getByRole("button", { name: CANCEL }).click();
  await expect(unlinkDialog).toHaveCount(0);
  await expect(page.getByTestId("invite-code")).toHaveCount(0);
});

test("a parent opening a lesson sees the cannot-play notice", async ({ page }) => {
  await signInAs(page, parentEmail, password);
  await page.goto("/dashboard?view=student");
  const link = page.locator('main a[href^="/dashboard/learn/"]').first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href as string);
  await expect(page.getByText(CANNOT_PLAY)).toBeVisible();
});
