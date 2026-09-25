CREATE TYPE "public"."response_source" AS ENUM('online', 'public', 'paper');--> statement-breakpoint
CREATE TYPE "public"."response_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "access_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "access_token_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "access_token_expiry_after_issue" CHECK ("access_token"."expires_at" > "access_token"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"instrument_version_id" uuid NOT NULL,
	"is_test" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "response_revision" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"response_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"outcomes" jsonb NOT NULL,
	"definition_hash" text NOT NULL,
	"evaluator_version" integer NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "response_revision_number_unique" UNIQUE("response_id","revision")
);
--> statement-breakpoint
CREATE TABLE "survey_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid,
	"shop_id" uuid,
	"instrument_version_id" uuid NOT NULL,
	"source" "response_source" NOT NULL,
	"status" "response_status" DEFAULT 'draft' NOT NULL,
	"is_test" boolean NOT NULL,
	"draft_answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"draft_revision" integer DEFAULT 0 NOT NULL,
	"draft_saved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"submit_request_key" text,
	"submit_payload_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_response_submitted_complete" CHECK ("survey_response"."status" = 'draft' OR ("survey_response"."submitted_at" IS NOT NULL AND "survey_response"."submit_payload_hash" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "access_token" ADD CONSTRAINT "access_token_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_instrument_version_id_instrument_version_id_fk" FOREIGN KEY ("instrument_version_id") REFERENCES "public"."instrument_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_revision" ADD CONSTRAINT "response_revision_response_id_survey_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."survey_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_revision" ADD CONSTRAINT "response_revision_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_instrument_version_id_instrument_version_id_fk" FOREIGN KEY ("instrument_version_id") REFERENCES "public"."instrument_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_token_invitation_idx" ON "access_token" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "invitation_shop_idx" ON "invitation" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "invitation_version_idx" ON "invitation" USING btree ("instrument_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_response_one_online_per_invitation" ON "survey_response" USING btree ("invitation_id") WHERE "survey_response"."source" = 'online';--> statement-breakpoint
CREATE INDEX "survey_response_shop_submitted_idx" ON "survey_response" USING btree ("shop_id","submitted_at" DESC NULLS LAST);