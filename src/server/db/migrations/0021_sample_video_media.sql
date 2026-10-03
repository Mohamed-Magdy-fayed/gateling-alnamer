-- Data migration (T2, noted in docs/build/steps/T2.md): one sample video asset, served by the
-- `sample` video provider from media/sample/lesson-sample.webm, attached to the published revision
-- of every sample video lesson that has no video yet. Idempotent; touches sample rows only.
INSERT INTO "media_assets" ("id", "kind", "provider", "storage_key", "status", "duration_s", "is_sample")
VALUES ('00000000-0000-7000-8000-000000000901', 'video', 'sample', 'lesson-sample.webm', 'ready', 20, true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
UPDATE "lesson_revisions" AS lr
SET "video_asset_id" = '00000000-0000-7000-8000-000000000901'
FROM "lessons" AS l
WHERE l."published_revision_id" = lr."id"
  AND l."kind" = 'video'
  AND l."is_sample" = true
  AND lr."is_sample" = true
  AND lr."video_asset_id" IS NULL;
