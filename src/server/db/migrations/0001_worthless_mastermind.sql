CREATE TYPE "public"."device_limit_mode" AS ENUM('strict', 'soft');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"device_limit" integer DEFAULT 2 NOT NULL,
	"device_limit_mode" "device_limit_mode" DEFAULT 'strict' NOT NULL,
	"refund_window_days" integer DEFAULT 7,
	"refund_max_opened_pct" integer DEFAULT 25,
	"default_commission_bp" integer DEFAULT 7000,
	"gateway_fee_bp" integer DEFAULT 250,
	"invoice_ttl_hours" integer DEFAULT 24,
	"sample_hidden_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_single_row" CHECK ("platform_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id","at" desc);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id","at" desc);