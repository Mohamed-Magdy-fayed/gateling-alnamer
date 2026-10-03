import { expect, test } from "@playwright/test";
import { nextClientIp, uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, password, runId, signIn, withDb } from "./helpers";

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const viewerEmail = `smoke-video-${runId}@alnamer.local`;
const outsiderEmail = `smoke-video-out-${runId}@alnamer.local`;

/** A paid (not free-preview) video lesson of a sample course, and that course. */
async function paidVideoLesson() {
  const rows = await withDb(
    (sql) => sql<{ lesson_id: string; course_id: string }[]>`
      select l.id as lesson_id, l.course_id
      from lessons l
      join lesson_revisions r on r.id = l.published_revision_id
      where l.kind = 'video' and r.is_free_preview = false and r.video_asset_id is not null
      order by l.id
      limit 1`,
  );
  const row = rows[0];
  if (!row) throw new Error("no paid sample video lesson seeded (migration 0021)");
  return row;
}

test.beforeAll(async ({ browser, baseURL }) => {
  for (const [name, address] of [
    ["Smoke Viewer", viewerEmail],
    ["Smoke Outsider", outsiderEmail],
  ] as const) {
    await createStudent(browser, baseURL, { name, email: address, password });
  }
  const { course_id: courseId } = await paidVideoLesson();
  // The purchase flow itself is covered by orders.spec.ts; here the viewer simply owns the course.
  await withDb(
    (sql) => sql`
      insert into entitlements (id, student_id, course_id, starts_at, ends_at, source)
      select gen_random_uuid(), u.id, ${courseId}, now() - interval '1 day', now() + interval '30 days', 'admin_grant'
      from users u where u.email = ${viewerEmail}`,
  );
});

test("an entitled student plays a paid video lesson with the name and public number watermark", async ({
  page,
}) => {
  const { lesson_id: lessonId } = await paidVideoLesson();
  const [viewer] = await withDb(
    (sql) => sql<{ public_number: string | null }[]>`
      select public_number from users where email = ${viewerEmail}`,
  );
  await signIn(page, viewerEmail, password);
  await page.goto(`/dashboard/learn/${lessonId}`);
  const video = page.locator("video");
  await expect(video).toHaveAttribute("src", /^\/api\/media\/sample\//);
  await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 1);
  const watermark = page.getByTestId("watermark");
  await expect(watermark).toContainText("Smoke Viewer");
  if (viewer?.public_number) await expect(watermark).toContainText(viewer.public_number);
});

test("the playback URL is refused to another signed-in student", async ({
  page,
  browser,
  baseURL,
}) => {
  const { lesson_id: lessonId } = await paidVideoLesson();
  await signIn(page, viewerEmail, password);
  await page.goto(`/dashboard/learn/${lessonId}`);
  const src = await page.locator("video").getAttribute("src");
  expect(src).toBeTruthy();

  const other = await browser.newContext({
    baseURL: baseURL as string,
    extraHTTPHeaders: { "x-real-ip": nextClientIp() },
  });
  try {
    const otherPage = await other.newPage();
    await signIn(otherPage, outsiderEmail, password);
    const response = await otherPage.request.get(src as string);
    expect(response.status()).toBe(403);
  } finally {
    await other.close();
  }
});
