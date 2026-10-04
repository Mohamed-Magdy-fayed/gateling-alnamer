-- Data migration (C1, noted in docs/build/steps/C1.md): the placeholder teacher terms, so the
-- "accept the terms" step works before the client sends the real text. The real text is a new
-- row (a new id); publishing it asks every teacher again. Idempotent.
INSERT INTO "terms_versions" ("id", "kind", "body", "is_placeholder", "published_at")
VALUES (
  'teacher-placeholder-1',
  'teacher',
  jsonb_build_object(
    'ar', 'هذا نص مؤقت لشروط المعلّمين إلى أن تصل الشروط الرسمية من إدارة المنصة. بقبوله تؤكد أن المحتوى الذي تنشره من إعدادك أو لديك حق نشره، وأنه يمرّ بمراجعة قبل النشر، وأن نسبة المنصة تُحسب حسب الإعدادات المعتمدة.',
    'en', 'This is placeholder text for the teacher terms until the platform sends the official terms. By accepting it you confirm that the content you publish is yours or that you have the right to publish it, that it is reviewed before publishing, and that the platform share follows the approved settings.'
  ),
  true,
  '2026-10-04T00:00:00Z'
)
ON CONFLICT ("id") DO NOTHING;
