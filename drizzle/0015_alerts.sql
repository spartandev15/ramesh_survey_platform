CREATE TYPE "public"."alert_status" AS ENUM('pending_review', 'approved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('none', 'open', 'closure_requested', 'resolved');--> statement-breakpoint
ALTER TYPE "public"."email_kind" ADD VALUE 'alert';--> statement-breakpoint
CREATE TABLE "alert_approval" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"approval_number" integer NOT NULL,
	"recipients" text[] NOT NULL,
	"saved_recipients" text[] NOT NULL,
	"source_revision" integer NOT NULL,
	"note" text,
	"approved_by" text,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_approval_number_unique" UNIQUE("case_id","approval_number")
);
--> statement-breakpoint
CREATE TABLE "alert_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"shop_id" uuid,
	"is_test" boolean NOT NULL,
	"alerts" jsonb NOT NULL,
	"source_revision" integer NOT NULL,
	"status" "alert_status" DEFAULT 'pending_review' NOT NULL,
	"outcome_changed_at" timestamp with time zone,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"follow_up" "follow_up_status" DEFAULT 'none' NOT NULL,
	"closure_requested_by" text,
	"closure_requested_at" timestamp with time zone,
	"resolution_outcome" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_case_response_id_unique" UNIQUE("response_id"),
	CONSTRAINT "alert_case_resolved_complete" CHECK ("alert_case"."follow_up" <> 'resolved' OR ("alert_case"."resolved_at" IS NOT NULL AND "alert_case"."resolution_outcome" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "case_note" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"author_user_id" text,
	"author_kind" text NOT NULL,
	"visibility" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_note_visibility" CHECK ("case_note"."visibility" IN ('shop', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "suppression_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"rule_label" text NOT NULL,
	"desired" text NOT NULL,
	"source_revision" integer NOT NULL,
	"is_test" boolean NOT NULL,
	"status" text DEFAULT 'outstanding' NOT NULL,
	"acknowledged_by" text,
	"acknowledged_at" timestamp with time zone,
	"result" text,
	"evidence" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_action_desired" CHECK ("suppression_action"."desired" IN ('apply', 'remove')),
	CONSTRAINT "suppression_action_status" CHECK ("suppression_action"."status" IN ('outstanding', 'acknowledged')),
	CONSTRAINT "suppression_action_ack_complete" CHECK ("suppression_action"."status" = 'outstanding' OR ("suppression_action"."acknowledged_at" IS NOT NULL AND "suppression_action"."result" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "email_intent" ALTER COLUMN "invitation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "alert_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_approval" ADD CONSTRAINT "alert_approval_case_id_alert_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."alert_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_approval" ADD CONSTRAINT "alert_approval_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_case" ADD CONSTRAINT "alert_case_response_id_survey_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_case" ADD CONSTRAINT "alert_case_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_case" ADD CONSTRAINT "alert_case_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_case" ADD CONSTRAINT "alert_case_closure_requested_by_user_id_fk" FOREIGN KEY ("closure_requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_case" ADD CONSTRAINT "alert_case_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_note" ADD CONSTRAINT "case_note_case_id_alert_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."alert_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_note" ADD CONSTRAINT "case_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_action" ADD CONSTRAINT "suppression_action_response_id_survey_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression_action" ADD CONSTRAINT "suppression_action_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_case_status_idx" ON "alert_case" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "alert_case_shop_idx" ON "alert_case" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "case_note_case_idx" ON "case_note" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "suppression_action_status_idx" ON "suppression_action" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "email_intent" ADD CONSTRAINT "email_intent_alert_approval_id_alert_approval_id_fk" FOREIGN KEY ("alert_approval_id") REFERENCES "public"."alert_approval"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_intent" ADD CONSTRAINT "email_intent_one_owner" CHECK (("email_intent"."invitation_id" IS NULL) <> ("email_intent"."alert_approval_id" IS NULL));