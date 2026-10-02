import { expect, type Page, test } from "@playwright/test";
import { extractCode, waitForMailText } from "./helpers/mailpit";

// Arabic is the default locale; labels below are the `ar` dictionary values.
const BRAND = "النمر";
const SIGN_UP = "إنشاء الحساب";
const SIGN_IN = "دخول";
const SIGN_OUT = "تسجيل الخروج";
const SEND_CODE = "إرسال الرمز";
const SAVE_PASSWORD = "حفظ كلمة المرور";
const FIELD_EMAIL = "البريد الإلكتروني";
const FIELD_PASSWORD = "كلمة المرور";
const FIELD_NAME = "الاسم الكامل";
const FIELD_CODE = "الرمز";
const FIELD_NEW_PASSWORD = "كلمة المرور الجديدة";
const SWITCH_TO_EN = "English";
const FIELD_USERNAME = "اسم المستخدم (اختياري)";
const FIELD_IDENTIFIER = "البريد الإلكتروني أو اسم المستخدم";
const DOB_DAY = "اليوم";
const DOB_MONTH = "الشهر";
const DOB_YEAR = "السنة";
const CONSENT = "أقرّ بأنني حصلت على موافقة ولي أمري على إنشاء هذا الحساب.";
const LINK_PARENT = "اربط حساب ولي أمرك ليتابع تقدّمك.";

const runId = Date.now().toString(36);
const email = `smoke-${runId}@alnamer.local`;
const password = "Smoke-pass-1";
const newPassword = "Smoke-pass-2";
const username = `smoke_${runId}`;
const minorEmail = `smoke-minor-${runId}@alnamer.local`;

/** Picks a date in the three DOB selects by option position, so it does not depend on month names. */
async function pickDate(page: Page, yearsAgo: number, monthIndex: number, dayIndex: number) {
  const year = String(new Date().getFullYear() - yearsAgo);
  await page.getByRole("combobox", { name: DOB_YEAR }).click();
  await page.getByRole("option", { name: year, exact: true }).click();
  await page.getByRole("combobox", { name: DOB_MONTH }).click();
  await page.getByRole("option").nth(monthIndex).click();
  await page.getByRole("combobox", { name: DOB_DAY }).click();
  await page.getByRole("option").nth(dayIndex).click();
}

async function signIn(page: Page, withPassword: string) {
  await page.goto("/sign-in");
  await page.getByLabel(FIELD_EMAIL).fill(email);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(withPassword);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL("**/dashboard");
}

test.describe.configure({ mode: "serial" });

test("public pages answer 200 and show the brand", async ({ page }) => {
  for (const path of ["/", "/courses", "/legal/terms"]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.getByText(BRAND).first(), path).toBeVisible();
  }
  await page.goto("/courses");
  const first = page.locator('main a[href^="/courses/"]').first();
  const href = await first.getAttribute("href");
  expect(href).toBeTruthy();
  const response = await page.goto(href as string);
  expect(response?.status()).toBe(200);
  await expect(page.getByText(BRAND).first()).toBeVisible();
});

test("the catalogue lists 4 courses and a card opens its page", async ({ page }) => {
  await page.goto("/courses");
  const cards = page.locator('main a[href^="/courses/"]');
  await expect(cards).toHaveCount(4);
  const title = (await cards.first().locator("h2").innerText()).trim();
  expect(title).not.toBe("");
  await cards.first().click();
  await page.waitForURL((url) => url.pathname.split("/").length === 3);
  await expect(page.locator("h1")).toContainText(title);
  await expect(page.locator("main ul li").first()).toBeVisible();
});

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
  await page.waitForURL("**/dashboard");
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

  await signIn(page, password);
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
  await page.waitForURL("**/dashboard");
  await expect(page.getByText(LINK_PARENT)).toBeVisible();
});

test("a duplicate email gets one generic error and a forgot-password link", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel(FIELD_NAME).fill("Someone Else");
  await page.getByLabel(FIELD_EMAIL).fill(email);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 30, 1, 3);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  const alert = page.locator('[data-slot="alert"]');
  await expect(alert).toContainText("تحقق من بياناتك");
  await expect(alert.getByRole("link", { name: "نسيت كلمة المرور؟" })).toBeVisible();
});

test("each dashboard view renders", async ({ page }) => {
  await signIn(page, password);
  for (const view of ["student", "parent", "teacher", "admin"]) {
    const response = await page.goto(`/dashboard?view=${view}`);
    expect(response?.status(), view).toBe(200);
    await expect(page.locator("h1").first(), view).toBeVisible();
    await expect(page.locator(`a[aria-current="page"][href*="view=${view}"]`)).toBeVisible();
  }
});

test("a lesson link on the student dashboard opens its learn page", async ({ page }) => {
  await signIn(page, password);
  await page.goto("/dashboard?view=student");
  const link = page.locator('main a[href^="/dashboard/learn/"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL("**/dashboard/learn/**");
  await expect(page.locator("h1")).not.toBeEmpty();
});

test("forgot password: code from Mailpit, reset, sign in with the new password", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel(FIELD_EMAIL).fill(email);
  await page.getByRole("button", { name: SEND_CODE }).click();
  const code = extractCode(await waitForMailText(email));

  await page.goto(`/reset-password?email=${encodeURIComponent(email)}`);
  await page.getByLabel(FIELD_CODE, { exact: true }).fill(code);
  await page.getByLabel(FIELD_NEW_PASSWORD).fill(newPassword);
  await page.getByRole("button", { name: SAVE_PASSWORD }).click();
  await expect(page.getByRole("link", { name: "تسجيل الدخول" })).toBeVisible();

  await signIn(page, newPassword);
});

test("language switch flips dir to ltr and back", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByRole("button", { name: SWITCH_TO_EN }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.locator('button[lang="ar"]').click();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

for (const locale of ["ar", "en"] as const) {
  test(`/courses?subject=<slug> filters to that subject (${locale})`, async ({
    baseURL,
    context,
    page,
  }) => {
    await context.addCookies([{ name: "locale", value: locale, url: baseURL as string }]);
    await page.goto("/courses?subject=mathematics");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator('main a[href^="/courses/"]')).toHaveCount(1);
    await expect(
      page.locator('nav a[aria-current="page"][href*="subject=mathematics"]'),
    ).toBeVisible();
    await page.goto("/courses?subject=physics");
    await expect(page.locator('main a[href^="/courses/"]')).toHaveCount(1);
    await page.goto("/courses");
    await expect(page.locator('main a[href^="/courses/"]')).toHaveCount(4);
  });
}

test("each dashboard placeholder section carries a sample badge", async ({ page }) => {
  await signIn(page, newPassword);
  const expected: Record<string, string[]> = {
    student: ["sample-progress", "sample-quizzes"],
    parent: ["sample-children"],
    teacher: ["sample-earnings", "sample-teacher-courses"],
    admin: ["sample-approvals", "sample-orders"],
  };
  for (const [view, ids] of Object.entries(expected)) {
    await page.goto(`/dashboard?view=${view}`);
    for (const id of ids) {
      await expect(page.getByTestId(id), `${view}:${id}`).toBeVisible();
    }
  }
});

test("the theme toggle sets data-theme and survives a reload", async ({
  context,
  page,
  baseURL,
}) => {
  await context.addCookies([{ name: "theme", value: "light", url: baseURL as string }]);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /المظهر الداكن/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(async () => (await context.cookies()).find((c) => c.name === "theme")?.value)
    .toBe("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("?lang=en switches to ltr and drops the param", async ({ page }) => {
  await page.goto("/courses?lang=en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  expect(new URL(page.url()).searchParams.has("lang")).toBe(false);
});

test.describe("first paint with an emulated dark scheme", () => {
  test.use({ colorScheme: "dark" });
  test("data-theme is dark at DOMContentLoaded with no cookie", async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __themeAtDcl: string | undefined }).__themeAtDcl =
          document.documentElement.dataset.theme;
      });
    });
    await page.goto("/");
    expect(
      await page.evaluate(() => (window as unknown as { __themeAtDcl?: string }).__themeAtDcl),
    ).toBe("dark");
  });
});
