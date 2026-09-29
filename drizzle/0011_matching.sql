CREATE TYPE "public"."match_status" AS ENUM('shop_unconfirmed', 'visit_unmatched', 'matched', 'duplicate_review');--> statement-breakpoint
CREATE TABLE "match_decision" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"shop_id" uuid,
	"visit_id" uuid,
	"other_response_id" uuid,
	"evidence" text,
	"actor_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_suggestion" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"evidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_suggestion_unique" UNIQUE("response_id","shop_id")
);
--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "match_status" "match_status" DEFAULT 'matched' NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "canonical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "duplicate_disposition" text;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "entered_by" text;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "respondent_context" jsonb;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "match_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "match_decision" ADD CONSTRAINT "match_decision_response_id_survey_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_decision" ADD CONSTRAINT "match_decision_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_decision" ADD CONSTRAINT "match_decision_visit_id_repair_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."repair_visit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_decision" ADD CONSTRAINT "match_decision_other_response_id_survey_response_id_fk" FOREIGN KEY ("other_response_id") REFERENCES "public"."survey_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_decision" ADD CONSTRAINT "match_decision_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_suggestion" ADD CONSTRAINT "shop_suggestion_response_id_survey_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_suggestion" ADD CONSTRAINT "shop_suggestion_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_decision_response_idx" ON "match_decision" USING btree ("response_id");--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_visit_id_repair_visit_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."repair_visit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_response_one_canonical_per_visit" ON "survey_response" USING btree ("visit_id") WHERE "survey_response"."canonical";--> statement-breakpoint
CREATE INDEX "survey_response_match_idx" ON "survey_response" USING btree ("match_status") WHERE "survey_response"."match_status" <> 'matched';--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_canonical_is_matched" CHECK (NOT "survey_response"."canonical" OR ("survey_response"."status" = 'submitted' AND "survey_response"."match_status" = 'matched'));