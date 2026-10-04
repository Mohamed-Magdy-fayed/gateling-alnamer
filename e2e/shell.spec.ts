import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { uniqueClientIpPerTest } from "./helpers/client-ip";
import { signInStaff } from "./smoke/helpers";

// A7a.3: per-role app shells and landings. Arabic is the default locale; labels are `ar` values.
const SIGN_UP = "إنشاء الحساب";
const SIGN_IN = "دخول";
const FIELD_NAME = "الاسم الكامل";
const FIELD_EMAIL = "البريد الإلكتروني";
const FIELD_PASSWORD = "كلمة المرور";
const FIELD_IDENTIFIER = "البريد الإلكتروني أو اسم المستخدم";
const DOB_DAY = "اليوم";
const DOB_MONTH = "الشهر";
const DOB_YEAR = "السنة";
const MAIN_NAV = "التنقل الرئيسي";
const NAV_DASHBOARD = "لوحتي";
const NAV_ACCOUNT = "حسابي";
const NAV_LINK_PARENT = "ربط حساب ولي الأمر";
const OPEN_MENU = "فتح القائمة";
const COMING_SOON = "قريبًا في نسخة الاختبار الكاملة";
const BROWSE_COURSES = "تصفّح الدورات";
const MY_COURSES = "دوراتي";
const EARNINGS = "الأرباح";
const TEACHER_APPLICATIONS = "طلبات انضمام المعلمين";
const CARDS_TITLE = "أبناؤك";
const ACCOUNT_TITLE = "حسابي";

const runId = Date.now().toString(36);
const password = "Shell-pass-1";
const people = {
  student: { name: "Shell Student", email: `shell-student-${runId}@alnamer.local` },
  parent: { name: "Shell Parent", email: `shell-parent-${runId}@alnamer.local` },
  teacher: { name: "Shell Teacher", email: `shell-teacher-${runId}@alnamer.local` },
  admin: { name: "Shell Admin", email: `shell-admin-${runId}@alnamer.local` },
} as const;
type Person = keyof typeof people;

test.describe.configure({ mode: "serial" });
uniqueClientIpPerTest();

async function pickDate(page: Page, yearsAgo: number) {
  await page.getByRole("combobox", { name: DOB_YEAR }).click();
  await page
    .getByRole("option", { name: String(new Date().getFullYear() - yearsAgo), exact: true })
    .click();
  await page.getByRole("combobox", { name: DOB_MONTH }).click();
  await page.getByRole("option").nth(4).click();
  await page.getByRole("combobox", { name: DOB_DAY }).click();
  await page.getByRole("option").nth(14).click();
}

async function signUp(page: Page, who: Person) {
  await page.goto("/sign-up");
  if (who === "parent") await page.getByRole("radio", { name: "ولي أمر" }).click();
  await page.getByLabel(FIELD_NAME).fill(people[who].name);
  await page.getByLabel(FIELD_EMAIL).fill(people[who].email);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 30);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await page.waitForURL("**/verify-email");
}

async function setRole(who: Person, role: string) {
  const sql = postgres(process.env.TEST_DATABASE_URL ?? "", { max: 1, onnotice: () => {} });
  try {
    await sql`update users set role = ${role} where email = ${people[who].email}`;
  } finally {
    await sql.end();
  }
}

async function signInTo(page: Page, who: Person, expectedPath = "/dashboard") {
  // Staff pass two-factor (A4): enrolment the first time, the challenge after that.
  if (who === "teacher" || who === "admin") {
    await signInStaff(page, people[who].email, password);
    return;
  }
  await page.getByLabel(FIELD_IDENTIFIER).fill(people[who].email);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await page.getByRole("button", { name: SIGN_IN, exact: true }).click();
  await page.waitForURL((url) => url.pathname === expectedPath);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "تسجيل الخروج", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("create one account per role", async ({ page }) => {
  for (const who of ["student", "parent", "teacher", "admin"] as const) {
    await signUp(page, who);
    if (who === "teacher" || who === "admin") await setRole(who, who);
    await page.goto("/dashboard");
    await signOut(page);
  }
});

const navByRole: Record<Person, { present: string[]; absent: string[] }> = {
  student: { present: [NAV_DASHBOARD, NAV_LINK_PARENT, NAV_ACCOUNT], absent: [] },
  parent: { present: [NAV_DASHBOARD, NAV_ACCOUNT], absent: [NAV_LINK_PARENT] },
  teacher: { present: [NAV_DASHBOARD, NAV_ACCOUNT], absent: [NAV_LINK_PARENT] },
  admin: { present: [NAV_DASHBOARD, NAV_ACCOUNT], absent: [NAV_LINK_PARENT] },
};

const landingByRole: Record<Person, (page: Page) => Promise<void>> = {
  student: async (page) => {
    await expect(page.getByRole("heading", { level: 2, name: MY_COURSES })).toBeVisible();
    await expect(page.getByRole("link", { name: BROWSE_COURSES })).toBeVisible();
  },
  parent: async (page) => {
    await expect(page.getByRole("heading", { name: CARDS_TITLE })).toBeVisible();
  },
  teacher: async (page) => {
    await expect(page.getByRole("heading", { level: 2, name: MY_COURSES })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: EARNINGS })).toBeVisible();
    await expect(page.getByText(COMING_SOON).first()).toBeVisible();
  },
  admin: async (page) => {
    await expect(page.getByRole("heading", { level: 2, name: TEACHER_APPLICATIONS })).toBeVisible();
    await expect(page.getByText(COMING_SOON).first()).toBeVisible();
  },
};

for (const who of ["student", "parent", "teacher", "admin"] as const) {
  test(`${who} sees their own nav and landing`, async ({ page }) => {
    await page.goto("/sign-in");
    await signInTo(page, who);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(people[who].name);

    const nav = page.getByRole("navigation", { name: MAIN_NAV });
    await expect(nav).toBeVisible();
    for (const label of navByRole[who].present) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
    for (const label of navByRole[who].absent) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
    await expect(nav.getByRole("link", { name: NAV_DASHBOARD, exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await landingByRole[who](page);

    // Real landings carry no W1 sample figures, and no view-as copy leaks into live data.
    await expect(page.locator('[data-testid^="sample-"]')).toHaveCount(0);

    // The skip link is the first stop and the main landmark exists.
    await page.keyboard.press("Tab");
    await expect(page.locator("a[href='#main']")).toBeFocused();
    await expect(page.locator("main#main")).toHaveCount(1);

    await page.getByRole("link", { name: NAV_ACCOUNT, exact: true }).click();
    await page.waitForURL("**/dashboard/account");
    await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_TITLE })).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: MAIN_NAV })
        .getByRole("link", { name: NAV_ACCOUNT, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await signOut(page);
  });
}

test("at 375px the sidebar is a Sheet with a focus trap that closes on Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/sign-in");
  await signInTo(page, "student");
  await expect(page.getByRole("navigation", { name: MAIN_NAV })).toHaveCount(0);

  const trigger = page.getByRole("button", { name: OPEN_MENU });
  const box = await trigger.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await trigger.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("navigation", { name: MAIN_NAV })).toBeVisible();
  for (const label of navByRole.student.present) {
    await expect(dialog.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[role="dialog"]')),
    );
    expect(inside, `focus stays in the sheet after ${i + 1} tabs`).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("sign-in honours ?next= for a same-origin path and ignores anything else", async ({
  page,
}) => {
  await page.goto("/dashboard/account");
  await page.waitForURL(
    (url) => url.pathname === "/sign-in" && url.searchParams.get("next") === "/dashboard/account",
  );
  await signInTo(page, "student", "/dashboard/account");
  await expect(page.getByRole("heading", { level: 1, name: ACCOUNT_TITLE })).toBeVisible();
  await signOut(page);

  await page.goto("/sign-in?next=%2F%2Fevil.example");
  await signInTo(page, "student", "/dashboard");
  await expect(new URL(page.url()).host).toBe(new URL(test.info().project.use.baseURL ?? "").host);
  await signOut(page);
});
