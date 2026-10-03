CREATE TYPE "public"."entitlement_source" AS ENUM('order', 'manual', 'admin_grant');--> statement-breakpoint
CREATE TYPE "public"."mock_invoice_status" AS ENUM('pending', 'paid', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."order_channel" AS ENUM('online', 'manual');--> statement-breakpoint
CREATE TYPE "public"."order_collector" AS ENUM('platform', 'teacher');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'paid_duplicate', 'expired', 'failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."refund_flag_reason" AS ENUM('duplicate', 'paid_after_access_end', 'over_cap_coupon');--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"source" "entitlement_source" NOT NULL,
	"order_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "entitlements_window_valid" CHECK ("entitlements"."ends_at" > "entitlements"."starts_at"),
	CONSTRAINT "entitlements_order_source_has_order" CHECK ("entitlements"."source" <> 'order' or "entitlements"."order_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "mock_gateway_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_reference" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" "mock_invoice_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_id" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"buyer_id" uuid NOT NULL,
	"beneficiary_student_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"course_revision_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"list_price_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"coupon_id" uuid,
	"teacher_rate_bp" integer NOT NULL,
	"channel" "order_channel" DEFAULT 'online' NOT NULL,
	"collected_by" "order_collector" DEFAULT 'platform' NOT NULL,
	"gateway_invoice_id" text,
	"gateway_payment_id" text,
	"gateway_fee_minor" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"refund_flag" "refund_flag_reason",
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_amounts_valid" CHECK ("orders"."list_price_minor" >= 0 and "orders"."discount_minor" >= 0 and "orders"."amount_minor" >= 0 and "orders"."amount_minor" = "orders"."list_price_minor" - "orders"."discount_minor"),
	CONSTRAINT "orders_currency_format" CHECK ("orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orders_paid_at_matches_status" CHECK (("orders"."paid_at" is not null) = ("orders"."status" in ('paid', 'paid_duplicate', 'refunded'))),
	CONSTRAINT "orders_teacher_rate_range" CHECK ("orders"."teacher_rate_bp" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_beneficiary_student_id_users_id_fk" FOREIGN KEY ("beneficiary_student_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_course_revision_id_course_revisions_id_fk" FOREIGN KEY ("course_revision_id") REFERENCES "public"."course_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entitlements_student_course_idx" ON "entitlements" USING btree ("student_id","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_pending_idx" ON "orders" USING btree ("beneficiary_student_id","course_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "orders_beneficiary_idx" ON "orders" USING btree ("beneficiary_student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_gateway_invoice_uq" ON "orders" USING btree ("gateway_invoice_id") WHERE gateway_invoice_id is not null;