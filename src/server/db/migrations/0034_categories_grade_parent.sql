ALTER TABLE "course_categories" DROP CONSTRAINT "course_categories_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_grade_parent" CHECK (("categories"."type" = 'grade') = ("categories"."parent_id" is not null));