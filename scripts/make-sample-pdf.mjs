// Generates media/sample/lesson-sample.pdf: a 2-page Arabic + English sample worksheet rendered by
// the locally installed Playwright Chromium (page.pdf). Nothing is downloaded. Run once and commit
// the output: `node scripts/make-sample-pdf.mjs`.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT = path.resolve("media/sample/lesson-sample.pdf");

const page = (n, ar, en) => `
<section class="page">
  <h1 dir="rtl">ورقة عمل تجريبية · الصفحة ${n}</h1>
  <h2>Sample worksheet · page ${n}</h2>
  <p dir="rtl">${ar}</p>
  <p>${en}</p>
  <ol dir="rtl">
    <li>احسب قيمة النهاية عندما تقترب س من 2.</li>
    <li>ارسم الدالة وحدّد نقاط عدم الاتصال.</li>
    <li>اشرح الفرق بين النهاية من اليمين والنهاية من اليسار.</li>
  </ol>
</section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color: #12302f; }
  .page { page-break-after: always; padding: 24px 8px; }
  .page:last-child { page-break-after: auto; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 0 0 24px; color: #4a6b6a; }
  p, li { font-size: 15px; line-height: 1.9; }
</style></head><body>
${page(1, "هذا ملف تجريبي يوضّح كيف تصل ملفات الدروس إلى الطالب مع ختم خاص به على كل صفحة.", "This sample file shows how lesson files reach the student with a personal stamp on every page.")}
${page(2, "تابع حل التمارين ثم راجع إجاباتك مع المعلم في الحصة القادمة.", "Work through the exercises, then review your answers with the teacher in the next class.")}
</body></html>`;

const browser = await chromium.launch();
try {
  const tab = await browser.newPage();
  await tab.setContent(html);
  const pdf = await tab.pdf({
    format: "A4",
    margin: { top: "18mm", bottom: "22mm", left: "16mm", right: "16mm" },
  });
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, pdf);
  console.log(`Wrote ${OUT} (${pdf.length} bytes).`);
} finally {
  await browser.close();
}
