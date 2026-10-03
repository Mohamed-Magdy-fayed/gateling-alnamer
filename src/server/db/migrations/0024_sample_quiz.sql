-- Data migration (T4, noted in docs/build/steps/T4.md): one sample question bank with four
-- questions, one quiz per course that has a sample quiz lesson (id derived from the course id, so
-- re-running is a no-op), linked to the published revision of each sample quiz lesson without one.
-- Idempotent; sample rows only.
INSERT INTO "question_banks" ("id", "teacher_id", "title", "is_sample")
SELECT '00000000-0000-7000-8000-000000000a01', c."teacher_id",
  '{"ar":"بنك أسئلة تجريبي","en":"Sample question bank"}'::jsonb, true
FROM "courses" c
WHERE c."is_sample" = true
ORDER BY c."slug"
LIMIT 1
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "questions" ("id", "bank_id", "kind", "body", "options", "correct", "explanation", "is_sample")
SELECT v.id::uuid, '00000000-0000-7000-8000-000000000a01', v.kind::question_kind, v.body::jsonb, v.options::jsonb, v.correct, v.explanation::jsonb, true
FROM (VALUES
  ('00000000-0000-7000-8000-000000000b01', 'mcq',
   '{"ar":"ما قيمة 2 + 3 × 4؟","en":"What is 2 + 3 × 4?"}',
   '[{"id":"a","text":{"ar":"20","en":"20"}},{"id":"b","text":{"ar":"14","en":"14"}},{"id":"c","text":{"ar":"24","en":"24"}},{"id":"d","text":{"ar":"9","en":"9"}}]',
   'b', '{"ar":"الضرب قبل الجمع: 3 × 4 = 12 ثم 2 + 12 = 14.","en":"Multiply first: 3 × 4 = 12, then 2 + 12 = 14."}'),
  ('00000000-0000-7000-8000-000000000b02', 'true_false',
   '{"ar":"مجموع زوايا المثلث 180 درجة.","en":"The angles of a triangle add up to 180 degrees."}',
   '[{"id":"true","text":{"ar":"صحيح","en":"True"}},{"id":"false","text":{"ar":"خطأ","en":"False"}}]',
   'true', NULL),
  ('00000000-0000-7000-8000-000000000b03', 'mcq',
   '{"ar":"أيّ مما يلي عدد أولي؟","en":"Which of these is a prime number?"}',
   '[{"id":"a","text":{"ar":"9","en":"9"}},{"id":"b","text":{"ar":"15","en":"15"}},{"id":"c","text":{"ar":"17","en":"17"}},{"id":"d","text":{"ar":"21","en":"21"}}]',
   'c', NULL),
  ('00000000-0000-7000-8000-000000000b04', 'true_false',
   '{"ar":"الماء يغلي عند 50 درجة مئوية عند مستوى سطح البحر.","en":"Water boils at 50 °C at sea level."}',
   '[{"id":"true","text":{"ar":"صحيح","en":"True"}},{"id":"false","text":{"ar":"خطأ","en":"False"}}]',
   'false', NULL)
) AS v(id, kind, body, options, correct, explanation)
WHERE EXISTS (SELECT 1 FROM "question_banks" WHERE "id" = '00000000-0000-7000-8000-000000000a01')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quizzes" ("id", "course_id", "title", "time_limit_s", "max_attempts", "pass_pct", "is_sample")
SELECT DISTINCT md5('sample-quiz:' || l."course_id"::text)::uuid, l."course_id",
  '{"ar":"اختبار تجريبي","en":"Sample quiz"}'::jsonb, 600, 3, 60, true
FROM "lessons" l
WHERE l."kind" = 'quiz' AND l."is_sample" = true
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quiz_questions" ("quiz_id", "question_id", "sort")
SELECT q."id", qs."id", row_number() OVER (PARTITION BY q."id" ORDER BY qs."id")
FROM "quizzes" q
CROSS JOIN "questions" qs
WHERE q."is_sample" = true
  AND q."id" = md5('sample-quiz:' || q."course_id"::text)::uuid
  AND qs."bank_id" = '00000000-0000-7000-8000-000000000a01'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "lesson_revisions" AS lr
SET "quiz_id" = md5('sample-quiz:' || l."course_id"::text)::uuid
FROM "lessons" AS l
WHERE l."published_revision_id" = lr."id"
  AND l."kind" = 'quiz'
  AND l."is_sample" = true
  AND lr."is_sample" = true
  AND lr."quiz_id" IS NULL
  AND EXISTS (SELECT 1 FROM "quizzes" WHERE "id" = md5('sample-quiz:' || l."course_id"::text)::uuid);
