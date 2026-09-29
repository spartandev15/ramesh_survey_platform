CREATE TYPE "public"."email_kind" AS ENUM('initial', 'reminder', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."email_state" AS ENUM('queued', 'sending', 'accepted', 'delivered', 'bounced', 'failed', 'acceptance_unknown', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('preview', 'committed');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('visits', 'legacy_ledger');--> statement-breakpoint
CREATE TYPE "public"."import_row_action" AS ENUM('created', 'reused', 'held', 'excluded', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('eligible', 'held', 'excluded');--> statement-breakpoint
CREATE TABLE "customer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"is_test" boolean NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"email_normalized" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_intent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"kind" "email_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"recipient" text NOT NULL,
	"is_test" boolean NOT NULL,
	"state" "email_state" DEFAULT 'queued' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_intent_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "import_batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"kind" "import_kind" NOT NULL,
	"is_test" boolean NOT NULL,
	"source_system" text NOT NULL,
	"file_name" text NOT NULL,
	"source_hash" text NOT NULL,
	"headers" text[] NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "import_batch_status" DEFAULT 'preview' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"row_count" integer NOT NULL,
	"counts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"committed_at" timestamp with time zone,
	"committed_by" text
);
--> statement-breakpoint
CREATE TABLE "import_row" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"action" "import_row_action",
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"visit_id" uuid,
	"invitation_id" uuid,
	"processed_at" timestamp with time zone,
	CONSTRAINT "import_row_number_unique" UNIQUE("batch_id","row_number")
);
--> statement-breakpoint
CREATE TABLE "legacy_survey_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_visit_key" text NOT NULL,
	"invited_on" date,
	"completed_on" date,
	"response_ref" text,
	"import_row_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_visit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"is_test" boolean NOT NULL,
	"source_system" text NOT NULL,
	"source_visit_key" text NOT NULL,
	"repair_order" text,
	"delivered_on" date,
	"delivered_on_raw" text,
	"import_row_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_opt_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "import_row_id" bigint;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "status" "invitation_status" DEFAULT 'eligible' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_survey_settings" ADD COLUMN "legacy_coverage_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "customer" ADD CONSTRAINT "customer_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intent" ADD CONSTRAINT "email_intent_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intent" ADD CONSTRAINT "email_intent_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_committed_by_user_id_fk" FOREIGN KEY ("committed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_batch_id_import_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_visit_id_repair_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."repair_visit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_row" ADD CONSTRAINT "import_row_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_survey_ledger" ADD CONSTRAINT "legacy_survey_ledger_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_survey_ledger" ADD CONSTRAINT "legacy_survey_ledger_import_row_id_import_row_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_row"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_visit" ADD CONSTRAINT "repair_visit_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_visit" ADD CONSTRAINT "repair_visit_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_visit" ADD CONSTRAINT "repair_visit_import_row_id_import_row_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_row"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_opt_out" ADD CONSTRAINT "shop_opt_out_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_shop_email_idx" ON "customer" USING btree ("shop_id","email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "email_intent_one_initial_or_reminder" ON "email_intent" USING btree ("invitation_id","kind") WHERE "email_intent"."kind" IN ('initial', 'reminder');--> statement-breakpoint
CREATE INDEX "email_intent_state_idx" ON "email_intent" USING btree ("state");--> statement-breakpoint
CREATE INDEX "import_batch_shop_time_idx" ON "import_batch" USING btree ("shop_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_survey_ledger_identity_unique" ON "legacy_survey_ledger" USING btree ("shop_id","source_system","source_visit_key");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_visit_identity_unique" ON "repair_visit" USING btree ("shop_id","source_system","source_visit_key","is_test");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_opt_out_unique" ON "shop_opt_out" USING btree ("shop_id","email_normalized");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_visit_id_repair_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."repair_visit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_import_row_id_import_row_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_row"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_one_per_visit" ON "invitation" USING btree ("visit_id");