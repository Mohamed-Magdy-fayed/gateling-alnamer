-- Data migration (T3, noted in docs/build/steps/T3.md): one sample PDF asset, served by
-- /api/files/[lessonId] from media/sample/lesson-sample.pdf with a per-student stamp, attached to the
-- published revision of every sample pdf lesson that has no file yet. Idempotent; sample rows only.
INSERT INTO "media_assets" ("id", "kind", "provider", "storage_key", "status", "is_sample")
VALUES ('00000000-0000-7000-8000-000000000902', 'pdf', 'sample', 'lesson-sample.pdf', 'ready', true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "lesson_revisions" AS lr
SET "file_asset_id" = '00000000-0000-7000-8000-000000000902'
FROM "lessons" AS l
WHERE l."published_revision_id" = lr."id"
  AND l."kind" = 'pdf'
  AND l."is_sample" = true
  AND lr."is_sample" = true
  AND lr."file_asset_id" IS NULL;
