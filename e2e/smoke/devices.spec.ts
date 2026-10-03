import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import {
  FIELD_EMAIL,
  FIELD_NAME,
  FIELD_PASSWORD,
  password,
  pickDate,
  runId,
  SIGN_IN,
  SIGN_OUT,
  SIGN_UP,
  SWITCH_TO_EN,
} from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

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
        header.locator("button[lang]"),
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
