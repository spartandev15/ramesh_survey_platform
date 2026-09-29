CREATE TYPE "public"."shop_mode" AS ENUM('test', 'live', 'paused');--> statement-breakpoint
CREATE TABLE "shop_survey_settings" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"mode" "shop_mode" DEFAULT 'test' NOT NULL,
	"activated_at" timestamp with time zone,
	"live_since" timestamp with time zone,
	"delivery_cutoff" date,
	"instrument_version_id" uuid,
	"reminder_delay_days" integer DEFAULT 7 NOT NULL,
	"link_lifetime_days" integer DEFAULT 90 NOT NULL,
	"alert_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "shop_survey_settings_reminder_range" CHECK ("shop_survey_settings"."reminder_delay_days" BETWEEN 1 AND 60),
	CONSTRAINT "shop_survey_settings_lifetime_range" CHECK ("shop_survey_settings"."link_lifetime_days" BETWEEN 1 AND 365),
	CONSTRAINT "shop_survey_settings_outreach_ready" CHECK ("shop_survey_settings"."mode" = 'test' OR ("shop_survey_settings"."delivery_cutoff" IS NOT NULL AND "shop_survey_settings"."instrument_version_id" IS NOT NULL AND "shop_survey_settings"."activated_at" IS NOT NULL)),
	CONSTRAINT "shop_survey_settings_live_since" CHECK (("shop_survey_settings"."mode" = 'live') = ("shop_survey_settings"."live_since" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "test_recipient_allowlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "test_recipient_allowlist_entry_unique" UNIQUE("entry")
);
--> statement-breakpoint
ALTER TABLE "shop_survey_settings" ADD CONSTRAINT "shop_survey_settings_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_survey_settings" ADD CONSTRAINT "shop_survey_settings_instrument_version_id_instrument_version_id_fk" FOREIGN KEY ("instrument_version_id") REFERENCES "public"."instrument_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_survey_settings" ADD CONSTRAINT "shop_survey_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_recipient_allowlist" ADD CONSTRAINT "test_recipient_allowlist_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;