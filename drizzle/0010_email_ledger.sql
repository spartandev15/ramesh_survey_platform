ALTER TYPE "public"."email_state" ADD VALUE 'held' BEFORE 'sending';--> statement-breakpoint
CREATE TABLE "email_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email_intent_id" uuid,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"detail" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_event_provider_unique" UNIQUE("provider","provider_event_id")
);
--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "due_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "state_reason" text;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "email_intent" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_event" ADD CONSTRAINT "email_event_email_intent_id_email_intent_id_fk" FOREIGN KEY ("email_intent_id") REFERENCES "public"."email_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_event_intent_idx" ON "email_event" USING btree ("email_intent_id");--> statement-breakpoint
CREATE INDEX "email_intent_due_idx" ON "email_intent" USING btree ("due_at") WHERE "email_intent"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "email_intent_provider_idx" ON "email_intent" USING btree ("provider_message_id");