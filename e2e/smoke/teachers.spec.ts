import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { nextClientIp, uniqueClientIpPerTest } from "../helpers/client-ip";
import { countMail, waitForMailText } from "../helpers/mailpit";
import {
  createStudent,
  enrolStaff,
  FIELD_EMAIL,
  FIELD_NAME,
  FIELD_PASSWORD,
  password,
  pickDate,
  runId,
  SIGN_OUT,
  signInStaff,
  withDb,
} from "./helpers";

// C1 teacher onboarding: apply, admin review, terms, invitations and the public profile.

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const applicantEmail = `smoke-apply-${runId}@alnamer.local`;
const rejectedEmail = `smoke-rejected-${runId}@alnamer.local`;
const adminEmail = `smoke-teachers-admin-${runId}@alnamer.local`;
const REASON = "نحتاج إلى شهادة تدريس سارية.";
const invitedEmail = `smoke-invited-${runId}@alnamer.local`;

test.beforeAll(async ({ browser, baseURL }) => {
  // Sign-up makes students; the test database promotes one to an admin and turns another into a
  // pending teacher application (the apply form itself is covered by the first test).
  await createStudent(browser, baseURL, {
    name: "Smoke Teachers Admin",
    email: adminEmail,
    password,
  });
  await createStudent(browser, baseURL, { name: "Smoke Rejected", email: rejectedEmail, password });
  await withDb(async (sql) => {
    await sql`update users set role = 'admin', email_verified_at = now() where email = ${adminEmail}`;
    await sql`update users set role = 'teacher', email_verified_at = now() where email = ${rejectedEmail}`;
    await sql`
      insert into teacher_profiles (user_id, public_name, bio, status, application_note)
      select id, '{"ar":"مرفوض","en":"Rejected"}'::jsonb, '{"ar":"","en":""}'::jsonb, 'applied', 'أدرّس الكيمياء للثانوية.'
      from users where email = ${rejectedEmail}`;
  });
});

/** Runs `steps` as the admin in a separate browser context (its own client IP). */
async function asAdmin(
  browser: Browser,
  baseURL: string | undefined,
  steps: (page: Page) => Promise<void>,
): Promise<void> {
  const admin = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": nextClientIp() },
  });
  try {
    const page = await admin.newPage();
    await signInStaff(page, adminEmail, password);
    await page.goto("/dashboard/admin/teachers");
    await steps(page);
  } finally {
    await admin.close();
  }
}

/** The application card on the admin page for the given email. */
const applicationOf = (page: Page, email: string) =>
  page.getByRole("article").filter({ hasText: email });

test("someone applies to teach, enrols two-factor and sees the review status", async ({ page }) => {
  await page.goto("/teach/apply");
  await page.getByLabel(FIELD_NAME).fill("Smoke Applicant");
  await page.getByLabel(FIELD_EMAIL).fill(applicantEmail);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 32, 3, 4);
  await page.getByLabel("ما الذي تدرّسه").fill("أدرّس الرياضيات للصف العاشر في عمّان.");
  await page.getByRole("button", { name: "إرسال الطلب" }).click();
  // Teachers are staff: two-factor enrolment comes first, then the email confirmation.
  await page.waitForURL("**/two-factor/setup?next=%2Fverify-email");

  // A fresh sign-in goes through the same enrolment, then the dashboard.
  await page.context().clearCookies();
  await signInStaff(page, applicantEmail, password);
  await expect(page.getByRole("heading", { name: "طلبك قيد المراجعة" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "دورة جديدة" })).toHaveCount(0);

  // Authoring stays closed until approval and the terms.
  await page.goto("/dashboard/teach/new");
  await page.waitForURL(/\/dashboard$/);
});

test("an admin approves; the teacher accepts the terms and authoring opens", async ({
  page,
  browser,
  baseURL,
}) => {
  await asAdmin(browser, baseURL, async (admin) => {
    const card = applicationOf(admin, applicantEmail);
    await expect(card.getByText("أدرّس الرياضيات للصف العاشر في عمّان.")).toBeVisible();
    await card.getByRole("button", { name: "اعتماد" }).click();
    await expect(admin.getByText("تم اعتماد الطلب وأُرسل بريد إلى المعلّم.")).toBeVisible();
    await expect(applicationOf(admin, applicantEmail)).toHaveCount(0);
  });
  await signInStaff(page, applicantEmail, password);
  await expect(page.getByRole("heading", { name: "شروط المعلّمين" })).toBeVisible();
  await expect(page.getByText("نص مؤقت إلى أن تصل الشروط الرسمية.")).toBeVisible();
  await page.goto("/dashboard/teach/new");
  await page.waitForURL(/\/dashboard$/);
  await page.getByRole("button", { name: "أوافق على الشروط" }).click();
  await expect(
    page.getByRole("main").getByRole("link", { name: "دورة جديدة" }).first(),
  ).toBeVisible();
  await page.goto("/dashboard/teach/new");
  await expect(page.getByRole("heading", { name: "دورة جديدة", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: SIGN_OUT }).first().click();
});

test("a short note and an under-18 date of birth are refused with field errors", async ({
  page,
}) => {
  await page.goto("/teach/apply");
  await page.getByLabel(FIELD_NAME).fill("Smoke Young");
  await page.getByLabel(FIELD_EMAIL).fill(`smoke-young-${runId}@alnamer.local`);
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 15, 3, 4);
  const note = page.getByLabel("ما الذي تدرّسه");
  const submit = page.getByRole("button", { name: "إرسال الطلب" });
  // The form checks the fields first, then the age.
  await note.fill("قصير");
  await submit.click();
  await expect(page.locator("#field-note-error")).toHaveText("اكتب من 10 إلى 1000 حرف عمّا تدرّسه.");
  await note.fill("أدرّس العلوم للصف السابع.");
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await submit.click();
  await expect(page.locator("#field-date_of_birth-error")).toContainText(
    "يجب أن يكون عمر المعلّم 18 سنة أو أكثر",
  );
  await expect(page).toHaveURL(/\/teach\/apply$/);
});

test("a rejection needs a reason, and the applicant sees it", async ({
  page,
  browser,
  baseURL,
}) => {
  await asAdmin(browser, baseURL, async (admin) => {
    const card = applicationOf(admin, rejectedEmail);
    await card.getByRole("button", { name: "رفض" }).click();
    await expect(card.getByText("اكتب السبب قبل الرفض.")).toBeVisible();
    await card.getByLabel("السبب").fill(REASON);
    await card.getByRole("button", { name: "رفض" }).click();
    await expect(admin.getByText("تم رفض الطلب وأُرسل السبب إلى المتقدّم بالبريد.")).toBeVisible();
    await expect(applicationOf(admin, rejectedEmail)).toHaveCount(0);
  });
  await signInStaff(page, rejectedEmail, password);
  await expect(page.getByRole("heading", { name: "لم تتم الموافقة على طلبك" })).toBeVisible();
  await expect(page.getByText(REASON)).toBeVisible();
});

test("an invited teacher joins approved, accepts the terms and gets a public profile", async ({
  page,
  browser,
  baseURL,
}) => {
  const before = await countMail(invitedEmail);
  await asAdmin(browser, baseURL, async (admin) => {
    await admin.getByLabel(FIELD_NAME).fill("Smoke Invited");
    await admin.getByLabel(FIELD_EMAIL).fill(invitedEmail);
    await admin.getByRole("button", { name: "إرسال الدعوة" }).click();
    await expect(admin.getByText("تم إرسال الدعوة.")).toBeVisible();
    // An address that already has an account is refused.
    await admin.getByLabel(FIELD_NAME).fill("Smoke Admin Again");
    await admin.getByLabel(FIELD_EMAIL).fill(adminEmail);
    await admin.getByRole("button", { name: "إرسال الدعوة" }).click();
    await expect(admin.getByText("لهذا البريد حساب بالفعل.")).toBeVisible();
  });
  const mail = await waitForMailText(invitedEmail, { after: before });
  const link = mail.match(/https?:\/\/\S+\/teach\/invite\/[A-Za-z0-9_-]+/)?.[0];
  expect(link, "the invite mail carries the link").toBeTruthy();
  const path = new URL(link as string).pathname;

  await page.goto(path);
  await expect(page.getByText("Smoke Invited")).toBeVisible();
  await page.getByLabel(FIELD_PASSWORD, { exact: true }).fill(password);
  await pickDate(page, 30, 2, 5);
  await page.getByRole("button", { name: "إنشاء حساب المعلّم" }).click();
  await page.waitForURL(/\/two-factor\/setup/);
  await enrolStaff(page, invitedEmail);
  await page.waitForURL("**/dashboard");
  // Approved by the invitation; the terms still come first.
  await page.getByRole("button", { name: "أوافق على الشروط" }).click();
  await expect(
    page.getByRole("main").getByRole("link", { name: "دورة جديدة" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: SIGN_OUT }).first().click();

  // The link is single use.
  await page.goto(path);
  await expect(page.getByText(/رابط الدعوة غير صالح/)).toBeVisible();

  // The public profile shows the approved teacher, nothing private.
  const number = await withDb(
    async (sql) =>
      (
        await sql<
          { n: string }[]
        >`select public_number as n from users where email = ${invitedEmail}`
      )[0]?.n,
  );
  await page.goto(`/teachers/${number}`);
  await expect(page.getByRole("heading", { name: "Smoke Invited", level: 1 })).toBeVisible();
  await expect(page.getByText(invitedEmail)).toHaveCount(0);
});

test("a pending or unknown teacher has no public profile", async ({ page }) => {
  const number = await withDb(
    async (sql) =>
      (
        await sql<
          { n: string }[]
        >`select public_number as n from users where email = ${rejectedEmail}`
      )[0]?.n,
  );
  const rejected = await page.goto(`/teachers/${number}`);
  expect(rejected?.status()).toBe(404);
  const unknown = await page.goto("/teachers/NOPE-0");
  expect(unknown?.status()).toBe(404);
});
