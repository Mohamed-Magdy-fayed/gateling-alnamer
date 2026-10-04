import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, password, runId, signInStaff, withDb } from "./helpers";

// C3 categories: an admin adds, renames, moves and deletes a subject; a category in use stays.

uniqueClientIpPerTest();

const adminEmail = `smoke-categories-admin-${runId}@alnamer.local`;
const nameAr = `مادة تجريبية ${runId}`;
const renamedAr = `مادة معدّلة ${runId}`;

test.beforeAll(async ({ browser, baseURL }) => {
  await createStudent(browser, baseURL, {
    name: "Smoke Categories Admin",
    email: adminEmail,
    password,
  });
  await withDb(async (sql) => {
    await sql`update users set role = 'admin', email_verified_at = now() where email = ${adminEmail}`;
  });
});

test("an admin manages subjects; a subject a course uses cannot be deleted", async ({ page }) => {
  await signInStaff(page, adminEmail, password);
  await page.getByRole("navigation").first().getByRole("link", { name: "التصنيفات" }).click();
  await page.waitForURL("**/dashboard/admin/categories");
  await expect(page.getByRole("heading", { level: 1, name: "التصنيفات" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: /منهج وزارة التربية الإماراتية/ }),
  ).toBeVisible();

  // Add.
  const addSubject = page.getByRole("form", { name: "إضافة مادة" });
  await addSubject.getByLabel("الاسم بالعربية").fill(nameAr);
  await addSubject.getByLabel("الاسم بالإنجليزية").fill(`Smoke subject ${runId}`);
  await addSubject.getByRole("button", { name: "إضافة" }).click();
  await expect(addSubject.getByText("تمت الإضافة.")).toBeVisible();
  const row = page.getByRole("article", { name: new RegExp(nameAr) });
  await expect(row.getByText(`smoke-subject-${runId}`.toLowerCase())).toBeVisible();

  // New rows go last: it can move up, not down.
  await expect(row.getByRole("button", { name: `نقل ${nameAr} إلى الأسفل` })).toBeDisabled();
  await row.getByRole("button", { name: `نقل ${nameAr} إلى الأعلى` }).click();
  await expect(row.getByRole("button", { name: `نقل ${nameAr} إلى الأسفل` })).toBeEnabled();

  // Rename.
  await row.getByRole("button", { name: `إعادة تسمية ${nameAr}` }).click();
  await row.getByLabel("الاسم بالعربية").fill(renamedAr);
  await row.getByRole("button", { name: "حفظ" }).click();
  const renamed = page.getByRole("article", { name: new RegExp(renamedAr) });
  await expect(renamed).toBeVisible();

  // Delete, after confirming.
  await renamed.getByRole("button", { name: `حذف ${renamedAr}` }).click();
  const dialog = page.getByRole("alertdialog", { name: "حذف هذا التصنيف؟" });
  await dialog.getByRole("button", { name: "حذف" }).click();
  await page.waitForURL("**/dashboard/admin/categories?done=deleted");
  await expect(page.getByText("تم حذف التصنيف.")).toBeVisible();
  await expect(page.getByRole("article", { name: new RegExp(renamedAr) })).toHaveCount(0);

  // A sample course uses Mathematics.
  const maths = page.getByRole("article", { name: /^الرياضيات/ });
  await maths.getByRole("button", { name: "حذف الرياضيات" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "حذف" }).click();
  await expect(maths.getByText(/لا يمكن حذف هذا التصنيف/)).toBeVisible();
  await expect(maths).toBeVisible();
});
