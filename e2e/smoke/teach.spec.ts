import { expect, test } from "@playwright/test";
import { nextClientIp, uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, password, runId, signIn, withDb } from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const teacherEmail = `smoke-teacher-${runId}@alnamer.local`;
const adminEmail = `smoke-admin-${runId}@alnamer.local`;
const courseTitle = `دورة اختبار ${runId}`;

test.beforeAll(async ({ browser, baseURL }) => {
  // Sign-up makes students; the test database then promotes one to an approved teacher and one
  // to an admin (teacher applications and staff invites are later steps).
  await createStudent(browser, baseURL, { name: "Smoke Teacher", email: teacherEmail, password });
  await createStudent(browser, baseURL, { name: "Smoke Admin", email: adminEmail, password });
  await withDb(async (sql) => {
    await sql`update users set role = 'teacher', email_verified_at = now() where email = ${teacherEmail}`;
    await sql`
      insert into teacher_profiles (user_id, public_name, bio, status)
      select id, '{"ar":"معلم الاختبار","en":"Smoke Teacher"}'::jsonb, '{"ar":"نبذة","en":"Bio"}'::jsonb, 'approved'
      from users where email = ${teacherEmail}`;
    await sql`update users set role = 'admin', email_verified_at = now() where email = ${adminEmail}`;
  });
});

test("a teacher drafts a course, an admin publishes it, and it appears in the catalogue", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page, teacherEmail, password);
  await page.goto("/dashboard/teach/new");
  await page.getByLabel("العنوان (بالعربية)").fill(courseTitle);
  await page.getByLabel("الوصف (بالعربية)").fill("دورة قصيرة لاختبار النشر.");
  await page.getByLabel(/السعر/).fill("150");
  await page.getByLabel("عنوان الدرس (بالعربية)").fill("الدرس الأول");
  await page.getByRole("button", { name: "حفظ المسودة" }).click();
  await page.waitForURL(/\/dashboard\/teach\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: courseTitle })).toBeVisible();
  await page.getByRole("button", { name: "إرسال للمراجعة" }).click();
  await expect(page.getByText("بانتظار مراجعة الإدارة ونشرها.")).toBeVisible();

  const admin = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": nextClientIp() },
  });
  try {
    const adminPage = await admin.newPage();
    await signIn(adminPage, adminEmail, password);
    const row = adminPage.getByRole("listitem").filter({ hasText: courseTitle });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "نشر" }).click();
    const dialog = adminPage.getByRole("alertdialog", { name: new RegExp(courseTitle) });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "نشر" }).click();
    await expect(adminPage.getByRole("listitem").filter({ hasText: courseTitle })).toHaveCount(0);
  } finally {
    await admin.close();
  }

  await page.goto("/courses");
  await expect(page.getByText(courseTitle)).toBeVisible();
});

test("a student cannot open the new course page", async ({ page, browser, baseURL }) => {
  const studentEmail = `smoke-teach-student-${runId}@alnamer.local`;
  await createStudent(browser, baseURL, { name: "Smoke Learner", email: studentEmail, password });
  await signIn(page, studentEmail, password);
  await page.goto("/dashboard/teach/new");
  await page.waitForURL("**/dashboard");
});
