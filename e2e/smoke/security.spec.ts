import { expect, type Page, test } from "@playwright/test";
import { uniqueClientIpPerTest } from "../helpers/client-ip";
import { createStudent, password, runId, signIn, withDb } from "./helpers";

// F5b: the page CSP ships report-only first, so violations only show as console messages. These
// tests keep the policy clean before H1 switches it to enforce.

test.describe.configure({ mode: "serial" });

uniqueClientIpPerTest();

const learnerEmail = `smoke-csp-${runId}@alnamer.local`;

/**
 * Collects CSP violations on every page this tab loads: a `securitypolicyviolation` listener
 * (it fires in report-only mode too), installed before any page script runs.
 */
async function cspViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction("__reportCsp", (text: string) => {
    seen.push(text);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCsp: (text: string) => void }).__reportCsp;
      report(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  return seen;
}

async function visit(page: Page, path: string): Promise<string> {
  const response = await page.goto(path);
  await page.waitForLoadState("networkidle");
  const csp = response?.headers()["content-security-policy-report-only"] ?? "";
  expect(csp, path).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
  return csp;
}

async function sampleLessons() {
  const rows = await withDb(
    (sql) => sql<{ slug: string; course_id: string; pdf: string; video: string }[]>`
      select c.slug, c.id as course_id,
        (select l.id from lessons l join lesson_revisions r on r.id = l.published_revision_id
          where l.course_id = c.id and l.kind = 'pdf' and r.file_asset_id is not null limit 1) as pdf,
        (select l.id from lessons l where l.course_id = c.id and l.kind = 'video' limit 1) as video
      from courses c
      where exists (select 1 from lessons l join lesson_revisions r on r.id = l.published_revision_id
        where l.course_id = c.id and l.kind = 'pdf' and r.file_asset_id is not null)
      limit 1`,
  );
  const row = rows[0];
  if (!row) throw new Error("no sample course with a PDF lesson (migration 0022)");
  return row;
}

test.beforeAll(async ({ browser, baseURL }) => {
  await createStudent(browser, baseURL, { name: "Smoke Csp", email: learnerEmail, password });
  const { course_id: courseId } = await sampleLessons();
  await withDb(
    (sql) => sql`
      insert into entitlements (id, student_id, course_id, starts_at, ends_at, source)
      select gen_random_uuid(), u.id, ${courseId}, now() - interval '1 day', now() + interval '30 days', 'admin_grant'
      from users u where u.email = ${learnerEmail}`,
  );
});

test("public pages carry a nonce CSP, the theme script carries the nonce, and nothing is reported", async ({
  page,
}) => {
  const reports = await cspViolations(page);
  const csp = await visit(page, "/");
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  // The browser hides the attribute value from the DOM; the `nonce` property keeps it.
  const themeNonce = await page.evaluate(
    () => document.querySelector<HTMLScriptElement>("head script:not([src])")?.nonce ?? null,
  );
  expect(themeNonce).toBe(nonce);
  const { slug } = await sampleLessons();
  for (const path of ["/courses", `/courses/${slug}`, "/sign-in", "/sign-up", "/forgot-password"]) {
    await visit(page, path);
  }
  expect(reports).toEqual([]);

  // Positive control: a cross-origin image (img-src 'self') is reported, so a clean run means clean.
  await page.evaluate(() => {
    const image = document.createElement("img");
    image.src = "https://csp-probe.invalid/x.png";
    document.body.append(image);
  });
  await expect.poll(() => reports.length).toBeGreaterThan(0);
});

test("signed-in pages, the PDF viewer and the video lesson report nothing", async ({ page }) => {
  const reports = await cspViolations(page);
  await signIn(page, learnerEmail, password);
  const { pdf, video } = await sampleLessons();
  await visit(page, "/dashboard");
  await visit(page, "/dashboard/account");
  await visit(page, `/dashboard/learn/${pdf}`);
  await expect(page.locator(`iframe[src="/api/files/${pdf}"]`)).toBeVisible();
  if (video) await visit(page, `/dashboard/learn/${video}`);
  expect(reports).toEqual([]);
});

test("static security headers: HSTS everywhere, API responses can neither run nor be framed", async ({
  page,
}) => {
  const home = await page.request.get("/");
  expect(home.headers()["strict-transport-security"]).toBe("max-age=63072000; includeSubDomains");
  expect(home.headers()["x-frame-options"]).toBe("DENY");
  const api = await page.request.get("/api/health");
  expect(api.headers()["content-security-policy"]).toBe(
    "default-src 'none'; frame-ancestors 'none'",
  );
  const report = await page.request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({
      "csp-report": { "effective-directive": "img-src", "blocked-uri": "data" },
    }),
  });
  expect(report.status()).toBe(204);
});
