import { expect, test } from "@playwright/test";
import { nextClientIp, uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, password, runId, signIn, withDb } from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const readerEmail = `smoke-pdf-${runId}@alnamer.local`;
const outsiderEmail = `smoke-pdf-out-${runId}@alnamer.local`;

/** A sample PDF lesson with a file (migration 0022), and its course. */
async function pdfLesson() {
  const rows = await withDb(
    (sql) => sql<{ lesson_id: string; course_id: string }[]>`
      select l.id as lesson_id, l.course_id
      from lessons l
      join lesson_revisions r on r.id = l.published_revision_id
      where l.kind = 'pdf' and r.file_asset_id is not null and r.is_free_preview = false
      order by l.id
      limit 1`,
  );
  const row = rows[0];
  if (!row) throw new Error("no sample PDF lesson seeded (migration 0022)");
  return row;
}

test.beforeAll(async ({ browser, baseURL }) => {
  for (const [name, address] of [
    ["Smoke Reader", readerEmail],
    ["Smoke Pdf Outsider", outsiderEmail],
  ] as const) {
    await createStudent(browser, baseURL, { name, email: address, password });
  }
  const { course_id: courseId } = await pdfLesson();
  // Buying is covered by orders.spec.ts; the reader simply owns the course here.
  await withDb(
    (sql) => sql`
      insert into entitlements (id, student_id, course_id, starts_at, ends_at, source)
      select gen_random_uuid(), u.id, ${courseId}, now() - interval '1 day', now() + interval '30 days', 'admin_grant'
      from users u where u.email = ${readerEmail}`,
  );
});

test("an entitled student opens a stamped sample PDF in the lesson viewer", async ({ page }) => {
  const { lesson_id: lessonId } = await pdfLesson();
  await signIn(page, readerEmail, password);
  await page.goto(`/dashboard/learn/${lessonId}`);
  await expect(page.locator(`iframe[src="/api/files/${lessonId}"]`)).toBeVisible();
  const response = await page.request.get(`/api/files/${lessonId}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(response.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect((await response.body()).subarray(0, 4).toString()).toBe("%PDF");
});

test("the file is refused to another signed-in student", async ({ browser, baseURL }) => {
  const { lesson_id: lessonId } = await pdfLesson();
  const other = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": nextClientIp() },
  });
  try {
    const page = await other.newPage();
    await signIn(page, outsiderEmail, password);
    const response = await page.request.get(`/api/files/${lessonId}`);
    expect(response.status()).toBe(403);
  } finally {
    await other.close();
  }
});
