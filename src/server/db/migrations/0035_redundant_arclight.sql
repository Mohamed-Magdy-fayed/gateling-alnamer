CREATE TABLE "teacher_payout_details" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"iban_ciphertext" text NOT NULL,
	"iban_last4" text NOT NULL,
	"iban_country" text NOT NULL,
	"holder_name" text NOT NULL,
	"bank_name" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_payout_details_last4" CHECK ("teacher_payout_details"."iban_last4" ~ '^[A-Z0-9]{4}$'),
	CONSTRAINT "teacher_payout_details_country" CHECK ("teacher_payout_details"."iban_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "teacher_payout_details_names_length" CHECK (length("teacher_payout_details"."holder_name") between 1 and 100 and length("teacher_payout_details"."bank_name") between 1 and 100),
	CONSTRAINT "teacher_payout_details_key_version" CHECK ("teacher_payout_details"."key_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "reauth_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teacher_payout_details" ADD CONSTRAINT "teacher_payout_details_user_id_teacher_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."teacher_profiles"("user_id") ON DELETE restrict ON UPDATE no action;