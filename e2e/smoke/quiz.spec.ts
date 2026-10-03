import { expect, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, password, runId, signIn, withDb } from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const takerEmail = `smoke-quiz-${runId}@alnamer.local`;

/** A sample quiz lesson with its quiz linked (migration 0024), and its course. */
async function quizLesson() {
  const rows = await withDb(
    (sql) => sql<{ lesson_id: string; course_id: string }[]>`
      select l.id as lesson_id, l.course_id
      from lessons l
      join lesson_revisions r on r.id = l.published_revision_id
      where l.kind = 'quiz' and r.quiz_id is not null and r.is_free_preview = false
      order by l.id
      limit 1`,
  );
  const row = rows[0];
  if (!row) throw new Error("no sample quiz lesson seeded (migration 0024)");
  return row;
}

test.beforeAll(async ({ browser, baseURL }) => {
  await createStudent(browser, baseURL, { name: "Smoke Quiz Taker", email: takerEmail, password });
  const { course_id: courseId } = await quizLesson();
  await withDb(
    (sql) => sql`
      insert into entitlements (id, student_id, course_id, starts_at, ends_at, source)
      select gen_random_uuid(), u.id, ${courseId}, now() - interval '1 day', now() + interval '30 days', 'admin_grant'
      from users u where u.email = ${takerEmail}`,
  );
});

test("a student takes the sample quiz, gets a score, and the landing lists it", async ({
  page,
}) => {
  const { lesson_id: lessonId } = await quizLesson();
  await signIn(page, takerEmail, password);
  await page.goto(`/dashboard/learn/${lessonId}`);
  await page.getByRole("button", { name: "ابدأ الاختبار" }).click();

  const groups = page.getByRole("radiogroup");
  await expect(groups.first()).toBeVisible();
  const count = await groups.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await groups.nth(i).getByRole("radio").first().click();
  }
  await page.getByRole("button", { name: "إرسال الإجابات" }).click();
  await expect(page.getByRole("heading", { name: /نتيجتك: \d+%/ })).toBeVisible();
  await expect(page.getByText(/أفضل نتيجة: \d+%/)).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "آخر نتائج الاختبارات" })).toBeVisible();
  await expect(page.getByText(/\d+% · /).first()).toBeVisible();
});
