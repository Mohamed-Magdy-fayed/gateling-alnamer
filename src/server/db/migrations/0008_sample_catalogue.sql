-- Data migration (hand-written by design): the sample catalogue from the client demo.
-- Fixed UUIDs, every row is_sample = true, idempotent (ON CONFLICT DO NOTHING + guarded UPDATEs).
-- Sample teachers are users without credentials; sample content can be hidden via platform_settings.sample_hidden_at.
INSERT INTO "users" ("id", "name", "email", "role", "is_sample") VALUES
('00000000-0000-7000-8000-000000000101', 'أ. معلم تجريبي 1', 'sample-teacher-1@example.invalid', 'teacher', true),
('00000000-0000-7000-8000-000000000102', 'أ. معلم تجريبي 2', 'sample-teacher-2@example.invalid', 'teacher', true),
('00000000-0000-7000-8000-000000000103', 'أ. معلم تجريبي 3', 'sample-teacher-3@example.invalid', 'teacher', true),
('00000000-0000-7000-8000-000000000104', 'أ. معلم تجريبي 4', 'sample-teacher-4@example.invalid', 'teacher', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "teacher_profiles" ("user_id", "public_name", "bio", "status", "is_sample") VALUES
('00000000-0000-7000-8000-000000000101', '{"ar":"أ. معلم تجريبي 1","en":"Sample Teacher 1"}'::jsonb, '{"ar":"معلم رياضيات تجريبي لعرض صفحة المعلم.","en":"A sample mathematics teacher to show the teacher page."}'::jsonb, 'approved', true),
('00000000-0000-7000-8000-000000000102', '{"ar":"أ. معلم تجريبي 2","en":"Sample Teacher 2"}'::jsonb, '{"ar":"معلم فيزياء تجريبي لعرض صفحة المعلم.","en":"A sample physics teacher to show the teacher page."}'::jsonb, 'approved', true),
('00000000-0000-7000-8000-000000000103', '{"ar":"أ. معلم تجريبي 3","en":"Sample Teacher 3"}'::jsonb, '{"ar":"معلم كيمياء تجريبي لعرض صفحة المعلم.","en":"A sample chemistry teacher to show the teacher page."}'::jsonb, 'approved', true),
('00000000-0000-7000-8000-000000000104', '{"ar":"أ. معلم تجريبي 4","en":"Sample Teacher 4"}'::jsonb, '{"ar":"معلم لغة إنجليزية تجريبي لعرض صفحة المعلم.","en":"A sample English teacher to show the teacher page."}'::jsonb, 'approved', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "categories" ("id", "type", "slug", "name_ar", "name_en", "sort", "is_sample") VALUES
('00000000-0000-7000-8000-000000000201', 'curriculum', 'uae-moe', 'منهج وزارة التربية الإماراتية', 'UAE Ministry of Education', 1, true),
('00000000-0000-7000-8000-000000000202', 'curriculum', 'saudi', 'المنهج السعودي', 'Saudi curriculum', 2, true),
('00000000-0000-7000-8000-000000000203', 'curriculum', 'british', 'المنهج البريطاني', 'British curriculum', 3, true),
('00000000-0000-7000-8000-000000000204', 'curriculum', 'american', 'المنهج الأمريكي', 'American curriculum', 4, true),
('00000000-0000-7000-8000-000000000205', 'grade', 'grade-9', 'الصف التاسع', 'Grade 9', 1, true),
('00000000-0000-7000-8000-000000000206', 'grade', 'grade-10', 'الصف العاشر', 'Grade 10', 2, true),
('00000000-0000-7000-8000-000000000207', 'grade', 'grade-11', 'الصف الحادي عشر', 'Grade 11', 3, true),
('00000000-0000-7000-8000-000000000208', 'grade', 'grade-12', 'الصف الثاني عشر', 'Grade 12', 4, true),
('00000000-0000-7000-8000-000000000209', 'subject', 'mathematics', 'الرياضيات', 'Mathematics', 1, true),
('00000000-0000-7000-8000-000000000210', 'subject', 'physics', 'الفيزياء', 'Physics', 2, true),
('00000000-0000-7000-8000-000000000211', 'subject', 'chemistry', 'الكيمياء', 'Chemistry', 3, true),
('00000000-0000-7000-8000-000000000212', 'subject', 'english', 'اللغة الإنجليزية', 'English', 4, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "courses" ("id", "slug", "teacher_id", "status", "is_sample") VALUES
('00000000-0000-7000-8000-000000000301', 'math-grade-12-calculus', '00000000-0000-7000-8000-000000000101', 'published', true),
('00000000-0000-7000-8000-000000000302', 'physics-grade-11-mechanics', '00000000-0000-7000-8000-000000000102', 'published', true),
('00000000-0000-7000-8000-000000000303', 'chemistry-grade-10-foundations', '00000000-0000-7000-8000-000000000103', 'published', true),
('00000000-0000-7000-8000-000000000304', 'english-grade-9-writing', '00000000-0000-7000-8000-000000000104', 'published', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "course_revisions" ("id", "course_id", "title", "description", "price_minor", "access_kind", "access_end_at", "access_days", "estimated_hours", "created_by", "is_sample") VALUES
('00000000-0000-7000-8000-000000000401', '00000000-0000-7000-8000-000000000301', '{"ar":"التفاضل والتكامل للصف الثاني عشر","en":"Grade 12 Calculus"}'::jsonb, '{"ar":"شرح منظم للنهايات والاشتقاق والتكامل مع أمثلة محلولة واختبار في نهاية كل وحدة.","en":"A structured walk through limits, derivatives and integrals with worked examples and a quiz after each unit."}'::jsonb, 45000, 'fixed_end', '2027-06-30T23:59:59+04:00'::timestamptz, NULL, 18, '00000000-0000-7000-8000-000000000101', true),
('00000000-0000-7000-8000-000000000402', '00000000-0000-7000-8000-000000000302', '{"ar":"الميكانيكا للصف الحادي عشر","en":"Grade 11 Mechanics"}'::jsonb, '{"ar":"الحركة والقوى والطاقة بأسلوب مبسط وتجارب مصورة.","en":"Motion, forces and energy explained simply, with filmed experiments."}'::jsonb, 38000, 'duration_days', NULL, 120, 14, '00000000-0000-7000-8000-000000000102', true),
('00000000-0000-7000-8000-000000000403', '00000000-0000-7000-8000-000000000303', '{"ar":"أساسيات الكيمياء للصف العاشر","en":"Grade 10 Chemistry Foundations"}'::jsonb, '{"ar":"الذرة والجدول الدوري والروابط الكيميائية بخطوات واضحة.","en":"Atoms, the periodic table and chemical bonding in clear steps."}'::jsonb, 32000, 'fixed_end', '2027-06-15T23:59:59+04:00'::timestamptz, NULL, 10, '00000000-0000-7000-8000-000000000103', true),
('00000000-0000-7000-8000-000000000404', '00000000-0000-7000-8000-000000000304', '{"ar":"الكتابة باللغة الإنجليزية للصف التاسع","en":"Grade 9 English Writing"}'::jsonb, '{"ar":"كتابة الفقرة والمقال خطوة بخطوة مع نماذج وتصحيح.","en":"Writing paragraphs and essays step by step, with models and feedback."}'::jsonb, 27500, 'duration_days', NULL, 90, 8, '00000000-0000-7000-8000-000000000104', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "courses" SET "published_revision_id" = '00000000-0000-7000-8000-000000000401' WHERE "id" = '00000000-0000-7000-8000-000000000301' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "courses" SET "published_revision_id" = '00000000-0000-7000-8000-000000000402' WHERE "id" = '00000000-0000-7000-8000-000000000302' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "courses" SET "published_revision_id" = '00000000-0000-7000-8000-000000000403' WHERE "id" = '00000000-0000-7000-8000-000000000303' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "courses" SET "published_revision_id" = '00000000-0000-7000-8000-000000000404' WHERE "id" = '00000000-0000-7000-8000-000000000304' AND "published_revision_id" IS NULL;
--> statement-breakpoint
INSERT INTO "course_categories" ("course_id", "category_id", "is_sample") VALUES
('00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000201', true),
('00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000208', true),
('00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000209', true),
('00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000202', true),
('00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000207', true),
('00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000210', true),
('00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000203', true),
('00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000206', true),
('00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000211', true),
('00000000-0000-7000-8000-000000000304', '00000000-0000-7000-8000-000000000204', true),
('00000000-0000-7000-8000-000000000304', '00000000-0000-7000-8000-000000000205', true),
('00000000-0000-7000-8000-000000000304', '00000000-0000-7000-8000-000000000212', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "sections" ("id", "course_id", "sort", "is_sample") VALUES
('00000000-0000-7000-8000-000000000501', '00000000-0000-7000-8000-000000000301', 1, true),
('00000000-0000-7000-8000-000000000502', '00000000-0000-7000-8000-000000000301', 2, true),
('00000000-0000-7000-8000-000000000503', '00000000-0000-7000-8000-000000000302', 1, true),
('00000000-0000-7000-8000-000000000504', '00000000-0000-7000-8000-000000000303', 1, true),
('00000000-0000-7000-8000-000000000505', '00000000-0000-7000-8000-000000000304', 1, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "section_revisions" ("id", "section_id", "title", "is_sample") VALUES
('00000000-0000-7000-8000-000000000601', '00000000-0000-7000-8000-000000000501', '{"ar":"الوحدة الأولى: النهايات","en":"Unit 1: Limits"}'::jsonb, true),
('00000000-0000-7000-8000-000000000602', '00000000-0000-7000-8000-000000000502', '{"ar":"الوحدة الثانية: الاشتقاق","en":"Unit 2: Derivatives"}'::jsonb, true),
('00000000-0000-7000-8000-000000000603', '00000000-0000-7000-8000-000000000503', '{"ar":"الحركة في بعد واحد","en":"Motion in one dimension"}'::jsonb, true),
('00000000-0000-7000-8000-000000000604', '00000000-0000-7000-8000-000000000504', '{"ar":"بنية الذرة","en":"Atomic structure"}'::jsonb, true),
('00000000-0000-7000-8000-000000000605', '00000000-0000-7000-8000-000000000505', '{"ar":"الفقرة المتماسكة","en":"The coherent paragraph"}'::jsonb, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "sections" SET "published_revision_id" = '00000000-0000-7000-8000-000000000601' WHERE "id" = '00000000-0000-7000-8000-000000000501' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "sections" SET "published_revision_id" = '00000000-0000-7000-8000-000000000602' WHERE "id" = '00000000-0000-7000-8000-000000000502' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "sections" SET "published_revision_id" = '00000000-0000-7000-8000-000000000603' WHERE "id" = '00000000-0000-7000-8000-000000000503' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "sections" SET "published_revision_id" = '00000000-0000-7000-8000-000000000604' WHERE "id" = '00000000-0000-7000-8000-000000000504' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "sections" SET "published_revision_id" = '00000000-0000-7000-8000-000000000605' WHERE "id" = '00000000-0000-7000-8000-000000000505' AND "published_revision_id" IS NULL;
--> statement-breakpoint
INSERT INTO "lessons" ("id", "course_id", "section_id", "kind", "sort", "is_sample") VALUES
('00000000-0000-7000-8000-000000000701', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000501', 'video', 1, true),
('00000000-0000-7000-8000-000000000702', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000501', 'pdf', 2, true),
('00000000-0000-7000-8000-000000000703', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000501', 'video', 3, true),
('00000000-0000-7000-8000-000000000704', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000501', 'quiz', 4, true),
('00000000-0000-7000-8000-000000000705', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000502', 'video', 1, true),
('00000000-0000-7000-8000-000000000706', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000502', 'pdf', 2, true),
('00000000-0000-7000-8000-000000000707', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000502', 'video', 3, true),
('00000000-0000-7000-8000-000000000708', '00000000-0000-7000-8000-000000000301', '00000000-0000-7000-8000-000000000502', 'quiz', 4, true),
('00000000-0000-7000-8000-000000000709', '00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000503', 'video', 1, true),
('00000000-0000-7000-8000-000000000710', '00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000503', 'pdf', 2, true),
('00000000-0000-7000-8000-000000000711', '00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000503', 'video', 3, true),
('00000000-0000-7000-8000-000000000712', '00000000-0000-7000-8000-000000000302', '00000000-0000-7000-8000-000000000503', 'quiz', 4, true),
('00000000-0000-7000-8000-000000000713', '00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000504', 'video', 1, true),
('00000000-0000-7000-8000-000000000714', '00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000504', 'pdf', 2, true),
('00000000-0000-7000-8000-000000000715', '00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000504', 'video', 3, true),
('00000000-0000-7000-8000-000000000716', '00000000-0000-7000-8000-000000000303', '00000000-0000-7000-8000-000000000504', 'quiz', 4, true),
('00000000-0000-7000-8000-000000000717', '00000000-0000-7000-8000-000000000304', '00000000-0000-7000-8000-000000000505', 'video', 1, true),
('00000000-0000-7000-8000-000000000718', '00000000-0000-7000-8000-000000000304', '00000000-0000-7000-8000-000000000505', 'pdf', 2, true),
('00000000-0000-7000-8000-000000000719', '00000000-0000-7000-8000-000000000304', '00000000-0000-7000-8000-000000000505', 'video', 3, true),
('00000000-0000-7000-8000-000000000720', '00000000-0000-7000-8000-000000000304', '00000000-0000-7000-8000-000000000505', 'quiz', 4, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "lesson_revisions" ("id", "lesson_id", "title", "is_free_preview", "duration_minutes", "is_sample") VALUES
('00000000-0000-7000-8000-000000000801', '00000000-0000-7000-8000-000000000701', '{"ar":"مقدمة في النهايات","en":"Introduction to limits"}'::jsonb, true, 12, true),
('00000000-0000-7000-8000-000000000802', '00000000-0000-7000-8000-000000000702', '{"ar":"ملخص قوانين النهايات","en":"Limit laws summary"}'::jsonb, false, 16, true),
('00000000-0000-7000-8000-000000000803', '00000000-0000-7000-8000-000000000703', '{"ar":"النهايات عند اللانهاية","en":"Limits at infinity"}'::jsonb, false, 20, true),
('00000000-0000-7000-8000-000000000804', '00000000-0000-7000-8000-000000000704', '{"ar":"اختبار الوحدة الأولى","en":"Unit 1 quiz"}'::jsonb, false, 24, true),
('00000000-0000-7000-8000-000000000805', '00000000-0000-7000-8000-000000000705', '{"ar":"تعريف المشتقة","en":"Defining the derivative"}'::jsonb, false, 12, true),
('00000000-0000-7000-8000-000000000806', '00000000-0000-7000-8000-000000000706', '{"ar":"جدول قواعد الاشتقاق","en":"Derivative rules table"}'::jsonb, false, 16, true),
('00000000-0000-7000-8000-000000000807', '00000000-0000-7000-8000-000000000707', '{"ar":"قاعدة السلسلة","en":"The chain rule"}'::jsonb, false, 20, true),
('00000000-0000-7000-8000-000000000808', '00000000-0000-7000-8000-000000000708', '{"ar":"اختبار الوحدة الثانية","en":"Unit 2 quiz"}'::jsonb, false, 24, true),
('00000000-0000-7000-8000-000000000809', '00000000-0000-7000-8000-000000000709', '{"ar":"الإزاحة والسرعة","en":"Displacement and velocity"}'::jsonb, true, 12, true),
('00000000-0000-7000-8000-000000000810', '00000000-0000-7000-8000-000000000710', '{"ar":"ورقة عمل التسارع","en":"Acceleration worksheet"}'::jsonb, false, 16, true),
('00000000-0000-7000-8000-000000000811', '00000000-0000-7000-8000-000000000711', '{"ar":"السقوط الحر","en":"Free fall"}'::jsonb, false, 20, true),
('00000000-0000-7000-8000-000000000812', '00000000-0000-7000-8000-000000000712', '{"ar":"اختبار قصير","en":"Short quiz"}'::jsonb, false, 24, true),
('00000000-0000-7000-8000-000000000813', '00000000-0000-7000-8000-000000000713', '{"ar":"مكونات الذرة","en":"Inside the atom"}'::jsonb, true, 12, true),
('00000000-0000-7000-8000-000000000814', '00000000-0000-7000-8000-000000000714', '{"ar":"ملخص الجدول الدوري","en":"Periodic table summary"}'::jsonb, false, 16, true),
('00000000-0000-7000-8000-000000000815', '00000000-0000-7000-8000-000000000715', '{"ar":"التوزيع الإلكتروني","en":"Electron configuration"}'::jsonb, false, 20, true),
('00000000-0000-7000-8000-000000000816', '00000000-0000-7000-8000-000000000716', '{"ar":"اختبار الوحدة","en":"Unit quiz"}'::jsonb, false, 24, true),
('00000000-0000-7000-8000-000000000817', '00000000-0000-7000-8000-000000000717', '{"ar":"الجملة الافتتاحية","en":"The topic sentence"}'::jsonb, true, 12, true),
('00000000-0000-7000-8000-000000000818', '00000000-0000-7000-8000-000000000718', '{"ar":"نموذج فقرة","en":"Sample paragraph"}'::jsonb, false, 16, true),
('00000000-0000-7000-8000-000000000819', '00000000-0000-7000-8000-000000000719', '{"ar":"أدوات الربط","en":"Linking words"}'::jsonb, false, 20, true),
('00000000-0000-7000-8000-000000000820', '00000000-0000-7000-8000-000000000720', '{"ar":"اختبار قصير","en":"Short quiz"}'::jsonb, false, 24, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000801' WHERE "id" = '00000000-0000-7000-8000-000000000701' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000802' WHERE "id" = '00000000-0000-7000-8000-000000000702' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000803' WHERE "id" = '00000000-0000-7000-8000-000000000703' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000804' WHERE "id" = '00000000-0000-7000-8000-000000000704' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000805' WHERE "id" = '00000000-0000-7000-8000-000000000705' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000806' WHERE "id" = '00000000-0000-7000-8000-000000000706' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000807' WHERE "id" = '00000000-0000-7000-8000-000000000707' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000808' WHERE "id" = '00000000-0000-7000-8000-000000000708' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000809' WHERE "id" = '00000000-0000-7000-8000-000000000709' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000810' WHERE "id" = '00000000-0000-7000-8000-000000000710' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000811' WHERE "id" = '00000000-0000-7000-8000-000000000711' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000812' WHERE "id" = '00000000-0000-7000-8000-000000000712' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000813' WHERE "id" = '00000000-0000-7000-8000-000000000713' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000814' WHERE "id" = '00000000-0000-7000-8000-000000000714' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000815' WHERE "id" = '00000000-0000-7000-8000-000000000715' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000816' WHERE "id" = '00000000-0000-7000-8000-000000000716' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000817' WHERE "id" = '00000000-0000-7000-8000-000000000717' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000818' WHERE "id" = '00000000-0000-7000-8000-000000000718' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000819' WHERE "id" = '00000000-0000-7000-8000-000000000719' AND "published_revision_id" IS NULL;
--> statement-breakpoint
UPDATE "lessons" SET "published_revision_id" = '00000000-0000-7000-8000-000000000820' WHERE "id" = '00000000-0000-7000-8000-000000000720' AND "published_revision_id" IS NULL;
