import { expect, type Page, test } from "@playwright/test";

// F1.9 visual guard: home, sign-in and the student dashboard (ar, light) at 375 and 1440 must not
// change when shadcn/ui is adopted. Baselines live in e2e/__screenshots__/f1-baseline/.
const FIELD_EMAIL = "البريد الإلكتروني";
const FIELD_PASSWORD = "كلمة المرور";
const FIELD_NAME = "الاسم الكامل";
const SIGN_UP = "إنشاء الحساب";

const VIEWPORTS = [
  { label: "375", width: 375, height: 800 },
  { label: "1440", width: 1440, height: 900 },
] as const;

const email = `visual-${Date.now().toString(36)}@alnamer.local`;

// Cold server: wait for the network and the web fonts before capturing.
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

test.use({ colorScheme: "light", locale: "ar-EG" });

for (const viewport of VIEWPORTS) {
  test.describe(`viewport ${viewport.label} @visual`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    const shot = { maxDiffPixelRatio: 0.01, animations: "disabled", fullPage: true } as const;

    test("home", async ({ page }) => {
      await page.goto("/");
      await settle(page);
      await expect(page).toHaveScreenshot(`home-${viewport.label}.png`, shot);
    });

    test("sign-in", async ({ page }) => {
      await page.goto("/sign-in");
      await settle(page);
      await expect(page).toHaveScreenshot(`sign-in-${viewport.label}.png`, shot);
    });

    test("student dashboard", async ({ page }) => {
      await page.goto("/sign-up");
      await page.getByLabel(FIELD_NAME).fill("Visual Student");
      await page.getByLabel(FIELD_EMAIL).fill(`${viewport.label}-${email}`);
      await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill("Visual-pass-1");
      // Student sign-up asks for a date of birth (three selects); pick an adult one by position.
      await page.getByRole("combobox", { name: "السنة" }).click();
      await page
        .getByRole("option", { name: String(new Date().getFullYear() - 25), exact: true })
        .click();
      await page.getByRole("combobox", { name: "الشهر" }).click();
      await page.getByRole("option").first().click();
      await page.getByRole("combobox", { name: "اليوم" }).click();
      await page.getByRole("option").first().click();
      await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
      await page.waitForURL("**/dashboard");
      await page.goto("/dashboard?view=student");
      await settle(page);
      await expect(page).toHaveScreenshot(`dashboard-student-${viewport.label}.png`, shot);
    });
  });
}
