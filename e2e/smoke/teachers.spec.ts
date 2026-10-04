import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import {
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

// C1 teacher onboarding: apply, the review status, then the terms once approved.

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const applicantEmail = `smoke-apply-${runId}@alnamer.local`;

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

test("once approved, the teacher accepts the terms and authoring opens", async ({ page }) => {
  // The admin approval screen is C1.3; here the database approves the application.
  await withDb(
    (sql) => sql`
      update teacher_profiles set status = 'approved', decided_at = now()
      where user_id = (select id from users where email = ${applicantEmail})`,
  );
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
