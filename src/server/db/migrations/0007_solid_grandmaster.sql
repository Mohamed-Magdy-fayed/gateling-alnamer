CREATE TYPE "public"."access_kind" AS ENUM('fixed_end', 'duration_days');--> statement-breakpoint
CREATE TYPE "public"."category_type" AS ENUM('curriculum', 'grade', 'subject');--> statement-breakpoint
CREATE TYPE "public"."course_status" AS ENUM('draft', 'in_review', 'published', 'hidden', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lesson_kind" AS ENUM('video', 'pdf', 'image', 'quiz');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('video', 'pdf', 'image');--> statement-breakpoint
CREATE TYPE "public"."media_provider" AS ENUM('bunny', 'mock', 'sample', 'firebase', 'local');--> statement-breakpoint
CREATE TYPE "public"."media_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."teacher_status" AS ENUM('applied', 'approved', 'rejected', 'suspended');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "category_type" NOT NULL,
	"parent_id" uuid,
	"slug" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_type_slug_unique" UNIQUE("type","slug")
);
--> statement-breakpoint
CREATE TABLE "course_categories" (
	"course_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	CONSTRAINT "course_categories_course_id_category_id_pk" PRIMARY KEY("course_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "course_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"title" jsonb NOT NULL,
	"description" jsonb NOT NULL,
	"cover_image_key" text,
	"price_minor" bigint NOT NULL,
	"access_kind" "access_kind" NOT NULL,
	"access_end_at" timestamp with time zone,
	"access_days" integer,
	"estimated_hours" integer,
	"created_by" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_revisions_price_nonneg" CHECK ("course_revisions"."price_minor" >= 0),
	CONSTRAINT "course_revisions_title_object" CHECK (jsonb_typeof("course_revisions"."title") = 'object'),
	CONSTRAINT "course_revisions_description_object" CHECK (jsonb_typeof("course_revisions"."description") = 'object'),
	CONSTRAINT "course_revisions_access_consistent" CHECK (("course_revisions"."access_kind" = 'fixed_end' and "course_revisions"."access_end_at" is not null and "course_revisions"."access_days" is null)
        or ("course_revisions"."access_kind" = 'duration_days' and "course_revisions"."access_days" > 0 and "course_revisions"."access_end_at" is null))
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"teacher_id" uuid NOT NULL,
	"status" "course_status" DEFAULT 'draft' NOT NULL,
	"published_revision_id" uuid,
	"pending_revision_id" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "lesson_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lesson_id" uuid NOT NULL,
	"title" jsonb NOT NULL,
	"body" jsonb,
	"is_free_preview" boolean DEFAULT false NOT NULL,
	"duration_minutes" integer,
	"video_asset_id" uuid,
	"file_asset_id" uuid,
	"quiz_id" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_revisions_title_object" CHECK (jsonb_typeof("lesson_revisions"."title") = 'object'),
	CONSTRAINT "lesson_revisions_body_object" CHECK ("lesson_revisions"."body" is null or jsonb_typeof("lesson_revisions"."body") = 'object')
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"kind" "lesson_kind" NOT NULL,
	"sort" integer NOT NULL,
	"published_revision_id" uuid,
	"pending_revision_id" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "media_kind" NOT NULL,
	"provider" "media_provider" NOT NULL,
	"provider_id" text,
	"storage_key" text,
	"status" "media_status" DEFAULT 'pending' NOT NULL,
	"duration_s" integer,
	"bytes" bigint,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section_id" uuid NOT NULL,
	"title" jsonb NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_revisions_title_object" CHECK (jsonb_typeof("section_revisions"."title") = 'object')
);
--> statement-breakpoint
CREATE TABLE "sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"course_id" uuid NOT NULL,
	"sort" integer NOT NULL,
	"published_revision_id" uuid,
	"pending_revision_id" uuid,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_name" jsonb NOT NULL,
	"bio" jsonb NOT NULL,
	"status" "teacher_status" DEFAULT 'applied' NOT NULL,
	"commission_rate_bp" integer,
	"terms_version_accepted" text,
	"terms_accepted_at" timestamp with time zone,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_profiles_public_name_object" CHECK (jsonb_typeof("teacher_profiles"."public_name") = 'object'),
	CONSTRAINT "teacher_profiles_bio_object" CHECK (jsonb_typeof("teacher_profiles"."bio") = 'object')
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_revisions" ADD CONSTRAINT "course_revisions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_revisions" ADD CONSTRAINT "course_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_published_revision_id_course_revisions_id_fk" FOREIGN KEY ("published_revision_id") REFERENCES "public"."course_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_pending_revision_id_course_revisions_id_fk" FOREIGN KEY ("pending_revision_id") REFERENCES "public"."course_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_revisions" ADD CONSTRAINT "lesson_revisions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_revisions" ADD CONSTRAINT "lesson_revisions_video_asset_id_media_assets_id_fk" FOREIGN KEY ("video_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_revisions" ADD CONSTRAINT "lesson_revisions_file_asset_id_media_assets_id_fk" FOREIGN KEY ("file_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_published_revision_id_lesson_revisions_id_fk" FOREIGN KEY ("published_revision_id") REFERENCES "public"."lesson_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_pending_revision_id_lesson_revisions_id_fk" FOREIGN KEY ("pending_revision_id") REFERENCES "public"."lesson_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_revisions" ADD CONSTRAINT "section_revisions_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_published_revision_id_section_revisions_id_fk" FOREIGN KEY ("published_revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sections" ADD CONSTRAINT "sections_pending_revision_id_section_revisions_id_fk" FOREIGN KEY ("pending_revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_categories_category_idx" ON "course_categories" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "course_revisions_course_idx" ON "course_revisions" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "courses_status_idx" ON "courses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "courses_teacher_idx" ON "courses" USING btree ("teacher_id");--> statement-breakpoint
CREATE INDEX "lessons_section_sort_idx" ON "lessons" USING btree ("section_id","sort");--> statement-breakpoint
CREATE INDEX "sections_course_sort_idx" ON "sections" USING btree ("course_id","sort");