CREATE TYPE "public"."parent_link_source" AS ENUM('created_child', 'invite');--> statement-breakpoint
CREATE TABLE "link_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"redeemed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "parent_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"source" "parent_link_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parent_links_parent_student_unique" UNIQUE("parent_id","student_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_by_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "link_invites" ADD CONSTRAINT "link_invites_parent_id_users_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_invites" ADD CONSTRAINT "link_invites_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_parent_id_users_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_invites_parent_idx" ON "link_invites" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "parent_links_student_idx" ON "parent_links" USING btree ("student_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_parent_id_users_id_fk" FOREIGN KEY ("created_by_parent_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;