import { expect, type Page, test } from "@playwright/test";
import { nextClientIp, uniqueClientIpPerTest } from "../helpers/client-ip";
import {
  BUY,
  BUY_FOR_CHILD,
  CHILD_ACCESS,
  CHILD_CAN_START,
  createStudent,
  FAIL,
  FAILED_TITLE,
  FIELD_EMAIL,
  FIELD_NAME,
  FIELD_PASSWORD,
  HAS_ACCESS,
  INVOICE_INVALID,
  markEmailVerified,
  NO_LESSON_ACCESS,
  PAID_TITLE,
  PAY,
  PAY_BANNER,
  password,
  pickDate,
  runId,
  SIGN_UP,
  START_LEARNING,
  signIn,
  TRY_AGAIN,
  withDb,
} from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const buyerEmail = `smoke-buy-${runId}@alnamer.local`;
const failEmail = `smoke-fail-${runId}@alnamer.local`;
const kidEmail = `smoke-kid-${runId}@alnamer.local`;
const guardianEmail = `smoke-guardian-${runId}@alnamer.local`;

async function openFirstCourse(page: Page): Promise<string> {
  await page.goto("/courses");
  const href = await page.locator('main a[href^="/courses/"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href as string);
  return href as string;
}

test.beforeAll(async ({ browser, baseURL }) => {
  for (const [name, address] of [
    ["Smoke Buyer", buyerEmail],
    ["Smoke Failer", failEmail],
    ["Smoke Kid", kidEmail],
  ] as const) {
    await createStudent(browser, baseURL, { name, email: address, password });
    await markEmailVerified(address);
  }
});

test("a signed-out visitor who buys is sent to sign in and back to the course", async ({
  page,
}) => {
  const href = await openFirstCourse(page);
  await page.getByRole("link", { name: BUY }).click();
  await page.waitForURL(/[/]sign-in/);
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toBe(href);
});

test("a student buys a sample course on the test payment page and starts learning", async ({
  page,
}) => {
  await signIn(page, buyerEmail, password);
  const href = await openFirstCourse(page);
  await page.getByRole("button", { name: BUY, exact: true }).click();
  await page.waitForURL("**/dev/pay/MOCK-*");
  await expect(page.getByText(PAY_BANNER)).toBeVisible();
  await page.getByRole("button", { name: PAY, exact: true }).click();
  await page.waitForURL(/[/]orders[/][0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(page.getByRole("heading", { name: PAID_TITLE })).toBeVisible();
  await page.getByRole("link", { name: START_LEARNING }).click();
  await page.waitForURL("**/dashboard/learn/**");
  await expect(page.getByText("Smoke Buyer").first()).toBeVisible();

  // The landing lists the course, and a second purchase of it is refused up front.
  await page.goto("/dashboard");
  await expect(page.getByText(HAS_ACCESS).first()).toBeVisible();
  await page.goto(href);
  await expect(page.getByText(HAS_ACCESS)).toBeVisible();
  await expect(page.getByRole("button", { name: BUY, exact: true })).toHaveCount(0);
});

test("a paid (non-preview) lesson opens for the buyer and is refused to a student without the course", async ({
  page,
  browser,
  baseURL,
}) => {
  const href = await openFirstCourse(page);
  // The second lesson of every sample course is paid (the first is a free preview).
  const paidLesson = await withDb(
    (sql) => sql<{ id: string }[]>`
      select l.id from lessons l
      join sections s on s.id = l.section_id
      join courses c on c.id = l.course_id
      where c.slug = ${href.split("/").pop() ?? ""}
      order by s.sort, l.sort offset 1 limit 1`,
  );
  const lessonPath = `/dashboard/learn/${paidLesson[0]?.id}`;

  await signIn(page, buyerEmail, password);
  await page.goto(lessonPath);
  await expect(page.locator("h1")).not.toBeEmpty();
  await expect(page.getByText(NO_LESSON_ACCESS)).toHaveCount(0);

  const other = await browser.newContext({ baseURL: baseURL as string });
  try {
    const otherPage = await other.newPage();
    await otherPage.setExtraHTTPHeaders({ "x-real-ip": nextClientIp() });
    await signIn(otherPage, failEmail, password);
    await otherPage.goto(lessonPath);
    await expect(otherPage.getByText(NO_LESSON_ACCESS)).toBeVisible();
  } finally {
    await other.close();
  }
});

test("a failed payment shows the failure and Try again opens a fresh payment page", async ({
  page,
}) => {
  await signIn(page, failEmail, password);
  await openFirstCourse(page);
  await page.getByRole("button", { name: BUY, exact: true }).click();
  await page.waitForURL("**/dev/pay/MOCK-*");
  const firstPayUrl = page.url();

  // Starting again supersedes the first invoice: its page can no longer be paid.
  await page.goBack();
  await page.getByRole("button", { name: BUY, exact: true }).click();
  await page.waitForURL("**/dev/pay/MOCK-*");
  const secondPayUrl = page.url();
  expect(secondPayUrl).not.toBe(firstPayUrl);
  await page.goto(firstPayUrl);
  await expect(page.getByText(INVOICE_INVALID)).toBeVisible();
  await expect(page.getByRole("button", { name: PAY, exact: true })).toHaveCount(0);

  await page.goto(secondPayUrl);
  await page.getByRole("button", { name: FAIL, exact: true }).click();
  await page.waitForURL(/[/]orders[/][0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(page.getByRole("heading", { name: FAILED_TITLE })).toBeVisible();
  await page.getByRole("button", { name: TRY_AGAIN, exact: true }).click();
  await page.waitForURL("**/dev/pay/MOCK-*");
  await expect(page.getByText(PAY_BANNER)).toBeVisible();
});

test("a parent buys for a linked child: no play control, and the child's landing lists it", async ({
  page,
  browser,
  baseURL,
}) => {
  // A parent account (adult, email confirmed), linked to the student by the database.
  await page.goto("/sign-up");
  await page.getByRole("radio", { name: "ولي أمر" }).click();
  await page.getByLabel(FIELD_NAME).fill("Smoke Guardian");
  await page.getByLabel(FIELD_EMAIL).fill(guardianEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 35, 2, 9);
  await page.getByRole("button", { name: SIGN_UP, exact: true }).click();
  await page.waitForURL("**/verify-email");
  await markEmailVerified(guardianEmail);
  await withDb(
    (sql) => sql`
      insert into parent_links (parent_id, student_id, source)
      select p.id, s.id, 'invite' from users p, users s
      where p.email = ${guardianEmail} and s.email = ${kidEmail}`,
  );

  // Sign-up already signed the parent in; the email was confirmed in the database above.
  await openFirstCourse(page);
  await expect(page.getByRole("radio", { name: /Smoke Kid/ })).toBeChecked();
  await page.getByRole("button", { name: BUY_FOR_CHILD }).click();
  await page.waitForURL("**/dev/pay/MOCK-*");
  await page.getByRole("button", { name: PAY, exact: true }).click();
  await page.waitForURL(/[/]orders[/][0-9A-Z]{4}-[0-9A-Z]{4}$/);
  await expect(page.getByText(CHILD_CAN_START)).toBeVisible();
  await expect(page.getByRole("link", { name: START_LEARNING })).toHaveCount(0);
  await expect(page.locator('a[href^="/dashboard/learn/"]')).toHaveCount(0);

  // The parent's card for the child lists the course, still with no lesson link.
  await page.goto("/dashboard");
  const card = page.getByRole("region", { name: "Smoke Kid" });
  await expect(card.getByText(CHILD_ACCESS)).toBeVisible();
  await expect(card.locator('a[href^="/dashboard/learn/"]')).toHaveCount(0);

  const kid = await browser.newContext({ baseURL: baseURL as string });
  try {
    const kidPage = await kid.newPage();
    await kidPage.setExtraHTTPHeaders({ "x-real-ip": nextClientIp() });
    await signIn(kidPage, kidEmail, password);
    await expect(kidPage.getByText(HAS_ACCESS).first()).toBeVisible();
  } finally {
    await kid.close();
  }
});
