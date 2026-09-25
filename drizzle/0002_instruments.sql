CREATE TYPE "public"."instrument_version_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "instrument" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "instrument_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "instrument_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "instrument_version_status" DEFAULT 'draft' NOT NULL,
	"is_test" boolean DEFAULT true NOT NULL,
	"definition" jsonb NOT NULL,
	"definition_hash" text,
	"source_note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"based_on_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	CONSTRAINT "instrument_version_number_unique" UNIQUE("instrument_id","version"),
	CONSTRAINT "instrument_version_published_complete" CHECK ("instrument_version"."status" = 'draft' OR ("instrument_version"."definition_hash" IS NOT NULL AND "instrument_version"."published_at" IS NOT NULL)),
	CONSTRAINT "instrument_version_positive" CHECK ("instrument_version"."version" > 0 AND "instrument_version"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_version" ADD CONSTRAINT "instrument_version_instrument_id_instrument_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instrument"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_version" ADD CONSTRAINT "instrument_version_based_on_version_id_instrument_version_id_fk" FOREIGN KEY ("based_on_version_id") REFERENCES "public"."instrument_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_version" ADD CONSTRAINT "instrument_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_version" ADD CONSTRAINT "instrument_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_version_one_draft" ON "instrument_version" USING btree ("instrument_id") WHERE "instrument_version"."status" = 'draft';