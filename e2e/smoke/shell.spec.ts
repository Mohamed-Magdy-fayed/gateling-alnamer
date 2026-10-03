import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import { BRAND, createStudent, password, SWITCH_TO_EN, shellEmail, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

test.beforeAll(async ({ browser, baseURL }) => {
  await createStudent(browser, baseURL, { name: "Smoke Shell", email: shellEmail, password });
});

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

test("each dashboard view renders", async ({ page }) => {
  await signIn(page, shellEmail, password);
  for (const view of ["student", "parent", "teacher", "admin"]) {
    const response = await page.goto(`/dashboard?view=${view}`);
    expect(response?.status(), view).toBe(200);
    await expect(page.locator("h1").first(), view).toBeVisible();
    await expect(page.locator(`a[aria-current="page"][href*="view=${view}"]`)).toBeVisible();
  }
});

test("a lesson link on the student dashboard opens its learn page", async ({ page }) => {
  await signIn(page, shellEmail, password);
  await page.goto("/dashboard?view=student");
  const link = page.locator('main a[href^="/dashboard/learn/"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL("**/dashboard/learn/**");
  await expect(page.locator("h1")).not.toBeEmpty();
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
  await signIn(page, shellEmail, password);
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

test("the signed-in header does not scroll horizontally at 320px", async ({ page }) => {
  await signIn(page, shellEmail, password);
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/dashboard", "/dashboard/account"]) {
    await page.goto(path);
    await expect(page.locator("header")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const page = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const inner = document.querySelector("header > div");
      const content = inner ? inner.scrollWidth - inner.clientWidth : 0;
      return Math.max(page, content);
    });
    expect(overflow, path).toBeLessThanOrEqual(0);
    // The account link lives in the Sheet nav below sm, and the language switch is a 44px target.
    await expect(page.locator('header a[href="/dashboard/account"]')).toBeHidden();
    const box = await page.locator("header form button[lang]").boundingBox();
    expect(box?.height ?? 0, path).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, path).toBeGreaterThanOrEqual(44);
  }
});
