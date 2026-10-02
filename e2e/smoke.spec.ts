import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { uniqueClientIpPerTest } from "./helpers/client-ip";
import { countMail, extractCode, waitForMailText } from "./helpers/mailpit";

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
const PARENT_ROLE = "ولي أمر";
const PARENT_AGE_ERROR = "حساب ولي الأمر يتطلب تاريخ ميلاد يثبت أن عمرك 18 عامًا أو أكثر.";
const CAPTCHA_FAILED = "لم نتمكن من التحقق من أنك لست برنامجًا آليًا";
const CREDENTIALS_ERROR = "البريد أو اسم المستخدم أو كلمة المرور غير صحيحة";
const LOCKOUT = "تم إيقاف تسجيل الدخول من هذا الجهاز مؤقتًا";
const VERIFY = "تأكيد";
const RESEND = "إرسال رمز جديد";
const CONTINUE = "المتابعة إلى لوحتي";
const BANNER_ACTION = "تأكيد البريد";
const BANNER = "أكّد بريدك الإلكتروني قبل شراء أي دورة";
const VERIFIED = "تم تأكيد بريدك الإلكتروني.";
const CODE_INVALID = "هذا الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.";
const CODE_SENT = "إذا كان هناك حساب بهذا البريد، فستصلك رسالة برمز من 6 أرقام خلال دقائق.";
const VERIFY_TITLE = "تأكيد بريدك الإلكتروني";
const VERIFIED_TITLE = "تم تأكيد البريد";
const EMAIL_DELAYED = "تأخّر وصول الرسالة. تحقق من مجلد الرسائل غير المرغوب فيها أو أعد الإرسال.";
const LINK_PARENT = "ربط حساب ولي الأمر قادم قريبًا ليتمكن من متابعة تقدّمك.";

const runId = Date.now().toString(36);
const email = `smoke-${runId}@alnamer.local`;
const password = "Smoke-pass-1";
const newPassword = "Smoke-pass-2";
const username = `smoke_${runId}`;
const parentEmail = `smoke-parent-${runId}@alnamer.local`;
const verifyEmail = `smoke-verify-${runId}@alnamer.local`;
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

/** Sign-up now lands on /verify-email; the dashboard is one navigation away (the email stays unverified). */
async function finishSignUp(page: Page) {
  await page.waitForURL("**/verify-email");
  await page.goto("/dashboard");
}

async function signIn(page: Page, withPassword: string) {
  await page.goto("/sign-in");
  await page.getByLabel(FIELD_EMAIL).fill(email);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(withPassword);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL("**/dashboard");
}

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

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

  await signIn(page, password);
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

async function startParentSignUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByRole("radio", { name: PARENT_ROLE }).click();
  await expect(page.getByRole("radio", { name: PARENT_ROLE })).toBeChecked();
  await page.getByLabel(FIELD_NAME).fill("Smoke Parent");
  await page.getByLabel(FIELD_EMAIL).fill(parentEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
}

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
  await finishSignUp(page);
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
  await signIn(otherPage, password);

  const before = await countMail(email);
  await page.goto("/forgot-password");
  await page.getByLabel(FIELD_EMAIL).fill(email);
  await page.getByRole("button", { name: SEND_CODE }).click();
  await page.waitForURL("**/reset-password");
  expect(page.url()).not.toContain("alnamer.local");
  await expect(page.getByText(CODE_SENT)).toBeVisible();
  await expect(page.getByLabel(FIELD_EMAIL)).toHaveCount(0);
  await expect(page.getByLabel(FIELD_CODE, { exact: true })).toBeFocused();
  const code = extractCode(await waitForMailText(email, { after: before }));

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

const SHOW_PASSWORD = "إظهار كلمة المرور";

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

// ---- Device limit (A5.4): block screen, throttled removal, sign out of other devices ----
const BLOCKED_TITLE = "وصلت إلى الحد الأقصى للأجهزة";
const REMOVE_DEVICE = "إزالة هذا الجهاز";
const THROTTLED = /يمكنك إزالة جهاز آخر بعد .*\d{4}/;
const SUPPORT = "تواصل مع الدعم";
const SUPPORT_SENT = "أرسلنا طلبك إلى فريق الدعم وإلى ولي أمرك إن وُجد.";
const PRIVATE_NOTICE = "النافذة الخاصة أو مسح بيانات المتصفح يجعلان هذا المتصفح يُحتسب جهازًا جديدًا.";
const SIGN_OUT_OTHERS = "تسجيل الخروج من الأجهزة الأخرى";
const SIGN_OUT_OTHERS_DONE = "تم تسجيل الخروج من الأجهزة الأخرى. ما زالت أجهزتك مسجلة.";
const ACCOUNT_LINK = "حسابي";

async function setDeviceLimit(limit: number) {
  const sql = postgres(process.env.TEST_DATABASE_URL ?? "", {
    max: 1,
    onnotice: () => {},
  });
  try {
    await sql`update platform_settings set device_limit = ${limit} where id = 1`;
  } finally {
    await sql.end();
  }
}

test.describe("device limit of 2", () => {
  const studentEmail = `smoke-dev-${runId}@alnamer.local`;
  let contexts: BrowserContext[] = [];

  test.beforeAll(async () => {
    await setDeviceLimit(2);
  });
  test.afterAll(async () => {
    await Promise.all(contexts.map((c) => c.close()));
    await setDeviceLimit(50);
  });

  async function newDevice(browser: Browser, baseURL: string, octet: number) {
    const context = await browser.newContext({
      baseURL,
      extraHTTPHeaders: { "x-real-ip": `10.${runOctet}.${octet}.${deviceIpSeed}` },
    });
    contexts = [...contexts, context];
    return { context, page: await context.newPage() };
  }
  const runOctet = Math.floor(Date.now() / 1000) % 250;
  const deviceIpSeed = (Date.now() % 200) + 20;

  async function signInStudent(page: Page, destination: RegExp) {
    await page.goto("/sign-in");
    await page.getByLabel(FIELD_EMAIL).fill(studentEmail);
    await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
    await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
    await page.waitForURL(destination);
  }

  test("the sign-up form shows the private-window notice for students", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByText(PRIVATE_NOTICE)).toBeVisible();
  });

  test("a third device is blocked, removes one, lands on the dashboard; a second removal is throttled", async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const first = await newDevice(browser, baseURL as string, 1);
    await first.page.goto("/sign-up");
    await first.page.getByLabel(FIELD_NAME).fill("Device Student");
    await first.page.getByLabel(FIELD_EMAIL).fill(studentEmail);
    await first.page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
    await pickDate(first.page, 25, 4, 14);
    await first.page.getByRole("button", { name: SIGN_UP, exact: true }).click();
    await first.page.waitForURL("**/verify-email");
    await first.page.goto("/dashboard");
    await first.page.getByRole("button", { name: SIGN_OUT }).click();
    await first.page.waitForURL((url) => url.pathname === "/");
    await signInStudent(first.page, /[/]dashboard/);

    const second = await newDevice(browser, baseURL as string, 2);
    await signInStudent(second.page, /[/]dashboard/);

    const third = await newDevice(browser, baseURL as string, 3);
    await signInStudent(third.page, /[/]devices[/]blocked/);
    await expect(third.page.getByRole("heading", { name: BLOCKED_TITLE })).toBeVisible();
    await expect(third.page.getByText(PRIVATE_NOTICE)).toBeVisible();
    await expect(third.page.getByRole("list").getByRole("listitem")).toHaveCount(2);

    // A5.8: every Remove trigger is described by its own device label.
    const rows = third.page.getByRole("list").getByRole("listitem");
    for (let i = 0; i < 2; i += 1) {
      const row = rows.nth(i);
      const label = (await row.locator("p").first().innerText()).trim();
      await expect(row.getByRole("button", { name: REMOVE_DEVICE })).toHaveAccessibleDescription(
        label,
      );
    }

    await third.page.getByRole("button", { name: REMOVE_DEVICE }).first().click();
    await third.page.getByRole("alertdialog").getByRole("button", { name: REMOVE_DEVICE }).click();
    await expect(third.page).toHaveURL(/[/]dashboard$/);
    await expect(third.page.getByRole("button", { name: SIGN_OUT })).toBeVisible();

    const fourth = await newDevice(browser, baseURL as string, 4);
    await signInStudent(fourth.page, /[/]devices[/]blocked/);
    await expect(fourth.page.getByText(THROTTLED).first()).toBeVisible();
    await expect(fourth.page.getByRole("button", { name: REMOVE_DEVICE }).first()).toBeDisabled();

    await fourth.page.getByRole("button", { name: SUPPORT }).click();
    await expect(fourth.page.getByText(SUPPORT_SENT)).toBeVisible();

    // Sign out of other devices from the third device keeps its own session.
    await third.page.getByRole("link", { name: ACCOUNT_LINK }).click();
    await third.page.waitForURL("**/dashboard/account");
    await third.page.getByRole("button", { name: SIGN_OUT_OTHERS }).click();
    await expect(third.page.getByText(SIGN_OUT_OTHERS_DONE)).toBeVisible();
    await third.page.goto("/dashboard");
    await expect(third.page.getByRole("button", { name: SIGN_OUT, exact: true })).toBeVisible();
    // A5.8: header targets are 44px and the header never overflows at 320px, in ar and en.
    await third.page.setViewportSize({ width: 320, height: 700 });
    await third.page.goto("/dashboard");
    for (const language of ["ar", "en"]) {
      if (language === "en") {
        await third.page.getByRole("button", { name: SWITCH_TO_EN }).click();
        await expect(third.page.locator("html")).toHaveAttribute("lang", "en");
      }
      const header = third.page.locator("header").first();
      const wide = await third.page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .filter((el) => !el.className.toString().includes("sr-only"))
          .filter(
            (el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5,
          )
          .map((el) => `${el.tagName}.${el.className.toString().slice(0, 40)}`)
          .slice(0, 6),
      );
      expect(wide, `${language} elements past the viewport`).toEqual([]);
      const overflow = await third.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${language} page overflow`).toBeLessThanOrEqual(0);
      const headerOverflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(headerOverflow, `${language} header overflow`).toBeLessThanOrEqual(0);
      const targets = [
        third.page.getByRole("link", { name: /^(حسابي|My account)$/ }),
        header.getByRole("button", { name: /^(تسجيل الخروج|Sign out)$/ }),
      ];
      for (const target of targets) {
        const box = await target.boundingBox();
        expect(box?.width ?? 0, `${language} target width`).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0, `${language} target height`).toBeGreaterThanOrEqual(44);
      }
    }

    // A5.8: the soft warning shows once, then the notice param leaves the URL.
    await third.page.goto("/dashboard?notice=device-over");
    await expect(third.page.getByText(/device limit|حد الأجهزة/)).toBeVisible();
    await expect(third.page).toHaveURL(/[/]dashboard$/);

    await first.page.goto("/dashboard");
    await expect(first.page).toHaveURL(/[/]sign-in/);
    await second.page.goto("/dashboard");
    await expect(second.page).toHaveURL(/[/]sign-in/);
  });
});
