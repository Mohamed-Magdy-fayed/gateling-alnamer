import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { countMail, extractCode, waitForMailText } from "./helpers/mailpit";

// A7a.4: the account page. Arabic is the default locale; labels are `ar` dictionary values.
const SIGN_UP = "إنشاء الحساب";
const SIGN_IN = "دخول";
const FIELD_NAME = "الاسم الكامل";
const FIELD_EMAIL = "البريد الإلكتروني";
const FIELD_PASSWORD = "كلمة المرور";
const FIELD_IDENTIFIER = "البريد الإلكتروني أو اسم المستخدم";
const FIELD_CODE = "الرمز";
const FIELD_CHILD_USERNAME = "اسم المستخدم";
const DOB_DAY = "اليوم";
const DOB_MONTH = "الشهر";
const DOB_YEAR = "السنة";
const ADD_CHILD = "إنشاء حساب لابن";
const CARDS_TITLE = "أبناؤك";
const ACCOUNT_TITLE = "حسابي";
const PROFILE = "الملف الشخصي";
const EMAIL_TITLE = "البريد الإلكتروني";
const PASSWORD_TITLE = "كلمة المرور";
const SESSIONS_TITLE = "الجلسات النشطة";
const DEVICES_TITLE = "أجهزتك";
const CURRENT_PASSWORD = "كلمة المرور الحالية";
const NEW_PASSWORD = "كلمة المرور الجديدة";
const CHANGE_PASSWORD = "تغيير كلمة المرور";
const PASSWORD_CHANGED = "تم تغيير كلمة المرور وتسجيل الخروج من الأجهزة الأخرى.";
const THIS_SESSION = "هذه الجلسة";
const THIS_DEVICE = "هذا الجهاز";
const REVOKE = "إنهاء الجلسة";
const REVOKED = "تم إنهاء الجلسة.";
const SEND_CODE = "إرسال الرمز";
const CONFIRM = "تأكيد";
const EMAIL_ADDED = "تمت إضافة بريدك الإلكتروني وتأكيده.";
const CODE_INVALID = "هذا الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.";
const SAVE = "حفظ";
const SAVED = "تم الحفظ.";
const REMOVE_DEVICE = "إزالة هذا الجهاز";
const DEVICE_REMOVED = "تمت إزالة الجهاز.";
const THROTTLED = "يمكنك إزالة جهاز آخر بعد";

const runId = Date.now().toString(36);
const octet = Math.floor(Date.now() / 1000) % 250;
const password = "Acct-pass-1";
const newPassword = "Acct-pass-2";
const parent = { name: "Account Parent", email: `acct-parent-${runId}@alnamer.local` };
const student = { name: "Account Student", email: `acct-student-${runId}@alnamer.local` };
const child = {
  name: "Account Child",
  username: `acctkid_${runId}`,
  password: "Kid-pass-1",
  email: `acct-child-${runId}@alnamer.local`,
};

test.describe.configure({ mode: "serial" });

let contexts: BrowserContext[] = [];
let ipSeed = 0;
let previousLimit = 2;

async function withDb<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

test.beforeAll(async () => {
  previousLimit = await withDb(async (sql) => {
    const [row] = await sql<{ device_limit: number }[]>`select device_limit from platform_settings`;
    await sql`update platform_settings set device_limit = 6 where id = 1`;
    return row?.device_limit ?? 2;
  });
});

test.afterAll(async () => {
  await Promise.all(contexts.map((context) => context.close()));
  await withDb(
    (sql) => sql`update platform_settings set device_limit = ${previousLimit} where id = 1`,
  );
});

/** A fresh browser context is a fresh device and a fresh client address. */
async function newPage(browser: Browser, baseURL: string): Promise<Page> {
  ipSeed += 1;
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { "x-real-ip": `10.${octet}.${Date.now() % 250}.${ipSeed + 40}` },
  });
  contexts = [...contexts, context];
  return context.newPage();
}

async function pickDate(page: Page, yearsAgo: number, monthIndex: number, dayIndex: number) {
  await page.getByRole("combobox", { name: DOB_YEAR }).click();
  await page
    .getByRole("option", { name: String(new Date().getFullYear() - yearsAgo), exact: true })
    .click();
  await page.getByRole("combobox", { name: DOB_MONTH }).click();
  await page.getByRole("option").nth(monthIndex).click();
  await page.getByRole("combobox", { name: DOB_DAY }).click();
  await page.getByRole("option").nth(dayIndex).click();
}

async function signUp(page: Page, who: { name: string; email: string }, asParent: boolean) {
  await page.goto("/sign-up");
  if (asParent) await page.getByRole("radio", { name: "ولي أمر" }).click();
  await page.getByLabel(FIELD_NAME).fill(who.name);
  await page.getByLabel(FIELD_EMAIL).fill(who.email);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 30, 4, 14);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await page.waitForURL("**/verify-email");
}

async function signIn(page: Page, identifier: string, secret: string) {
  await page.goto("/sign-in");
  await page.getByLabel(FIELD_IDENTIFIER).fill(identifier);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(secret);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL("**/dashboard");
}

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

let parentOne: Page;
let parentTwo: Page;

test("changing the password signs out the other browser and keeps this one", async ({
  browser,
  baseURL,
}) => {
  parentOne = await newPage(browser, baseURL as string);
  await signUp(parentOne, parent, true);
  await parentOne.goto("/dashboard/account");
  await expect(parentOne.getByRole("heading", { level: 1, name: ACCOUNT_TITLE })).toBeVisible();

  parentTwo = await newPage(browser, baseURL as string);
  await signIn(parentTwo, parent.email, password);

  const form = section(parentOne, PASSWORD_TITLE);
  await form.getByLabel(CURRENT_PASSWORD, { exact: true }).fill(password);
  await form.getByLabel(NEW_PASSWORD, { exact: true }).fill(newPassword);
  await form.getByRole("button", { name: CHANGE_PASSWORD }).click();
  await expect(form.getByText(PASSWORD_CHANGED)).toBeVisible();

  await parentOne.reload();
  await expect(parentOne.getByRole("heading", { level: 1, name: ACCOUNT_TITLE })).toBeVisible();
  await parentTwo.goto("/dashboard");
  await expect(parentTwo).toHaveURL(/[/]sign-in/);
});

test("the profile saves a new display name", async () => {
  const form = section(parentOne, PROFILE);
  await form.getByLabel(FIELD_NAME).fill("Account Parent Renamed");
  await form.getByRole("button", { name: SAVE, exact: true }).click();
  await expect(form.getByText(SAVED)).toBeVisible();
  await parentOne.goto("/dashboard");
  await expect(parentOne.getByRole("heading", { level: 1 })).toContainText(
    "Account Parent Renamed",
  );
});

test("a second session is listed and ending it signs that browser out", async ({
  browser,
  baseURL,
}) => {
  const other = await newPage(browser, baseURL as string);
  await signIn(other, parent.email, newPassword);

  await parentOne.goto("/dashboard/account");
  const sessions = section(parentOne, SESSIONS_TITLE);
  const rows = sessions.getByRole("listitem");
  await expect(rows).toHaveCount(2);
  await expect(sessions.getByText(THIS_SESSION)).toHaveCount(1);
  await expect(
    rows.filter({ hasText: THIS_SESSION }).getByRole("button", { name: REVOKE }),
  ).toHaveCount(0);

  await rows.filter({ hasNotText: THIS_SESSION }).getByRole("button", { name: REVOKE }).click();
  const dialog = parentOne.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: REVOKE }).click();
  await expect(sessions.getByText(REVOKED)).toBeVisible();
  await expect(rows).toHaveCount(1);

  await other.goto("/dashboard");
  await expect(other).toHaveURL(/[/]sign-in/);
});

test("a parent-created child adds an email, verifies it with the mailed code and sees it", async ({
  browser,
  baseURL,
}) => {
  // Creating a child needs a verified parent email.
  await withDb(
    (sql) => sql`update users set email_verified_at = now() where email = ${parent.email}`,
  );
  await parentOne.goto("/dashboard");
  await expect(parentOne.getByRole("heading", { name: CARDS_TITLE })).toBeVisible();
  await parentOne.getByRole("button", { name: ADD_CHILD }).click();
  const sheet = parentOne.getByRole("dialog");
  await sheet.getByLabel(FIELD_NAME).fill(child.name);
  await sheet.getByLabel(FIELD_CHILD_USERNAME, { exact: true }).fill(child.username);
  await sheet.getByLabel(FIELD_PASSWORD, { exact: true }).fill(child.password);
  await pickDate(parentOne, 10, 3, 5);
  await sheet.getByRole("button", { name: ADD_CHILD }).click();
  await expect(parentOne.getByRole("region", { name: child.name })).toBeVisible();

  const kid = await newPage(browser, baseURL as string);
  await signIn(kid, child.username, child.password);
  await kid.goto("/dashboard/account");
  const email = section(kid, EMAIL_TITLE);
  await email.getByLabel(FIELD_EMAIL, { exact: true }).fill(child.email);
  // Adding an email asks for the current password (A8 M1).
  await email.getByLabel(CURRENT_PASSWORD, { exact: true }).fill(child.password);
  const before = await countMail(child.email);
  await email.getByRole("button", { name: SEND_CODE }).click();
  const code = extractCode(await waitForMailText(child.email, { after: before }));
  await email.getByLabel(FIELD_CODE, { exact: true }).fill("000000");
  await email.getByRole("button", { name: CONFIRM, exact: true }).click();
  await expect(email.getByText(CODE_INVALID)).toBeVisible();
  await email.getByLabel(FIELD_CODE, { exact: true }).fill(code);
  await email.getByRole("button", { name: CONFIRM, exact: true }).click();
  await expect(email.getByText(EMAIL_ADDED)).toBeVisible();
  await expect(email.locator("bdi[dir='ltr']").filter({ hasText: child.email })).toHaveCount(1);
  await expect(email.getByRole("button", { name: SEND_CODE })).toHaveCount(0);
});

test("a student sees devices, removes a non-current one, and the weekly throttle is respected", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const first = await newPage(browser, baseURL as string);
  await signUp(first, student, false);
  // Sign-up opens a session without a device; signing in registers this browser as one.
  await first.goto("/dashboard");
  await first.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await first.waitForURL((url) => url.pathname === "/");
  await signIn(first, student.email, password);
  const second = await newPage(browser, baseURL as string);
  await signIn(second, student.email, password);
  const third = await newPage(browser, baseURL as string);
  await signIn(third, student.email, password);

  await first.goto("/dashboard/account");
  const devices = section(first, DEVICES_TITLE);
  const rows = devices.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  await expect(devices.getByText(THIS_DEVICE, { exact: true })).toHaveCount(1);
  await expect(
    rows
      .filter({ has: first.getByText(THIS_DEVICE, { exact: true }) })
      .getByRole("button", { name: REMOVE_DEVICE }),
  ).toHaveCount(0);

  await rows
    .filter({ hasNot: first.getByText(THIS_DEVICE, { exact: true }) })
    .first()
    .getByRole("button", { name: REMOVE_DEVICE })
    .click();
  const dialog = first.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: REMOVE_DEVICE }).click();
  await expect(devices.getByText(DEVICE_REMOVED)).toBeVisible();
  await expect(rows).toHaveCount(2);

  // The throttle: the other device cannot be removed for a week, and the reason is on screen.
  const remaining = rows
    .filter({ hasNot: first.getByText(THIS_DEVICE, { exact: true }) })
    .getByRole("button", { name: REMOVE_DEVICE });
  await expect(remaining).toBeDisabled();
  await expect(devices.getByText(THROTTLED)).toBeVisible();

  await first.reload();
  await expect(first.getByRole("heading", { level: 1, name: ACCOUNT_TITLE })).toBeVisible();
  await second.goto("/dashboard");
  await third.goto("/dashboard");
  // A redirect after streaming starts is a client navigation, so poll for it.
  await expect
    .poll(() => [second, third].filter((page) => /[/]sign-in/.test(page.url())).length)
    .toBe(1);
});
