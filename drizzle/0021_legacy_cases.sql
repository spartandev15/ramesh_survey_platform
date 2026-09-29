ALTER TYPE "public"."import_kind" ADD VALUE 'legacy_cases';--> statement-breakpoint
CREATE TABLE "legacy_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_ref" text NOT NULL,
	"legacy_status" text NOT NULL,
	"opened_on" date,
	"summary" text,
	"legacy_owner" text,
	"visit_key" text,
	"customer_name" text,
	"response_ref" text,
	"legacy_notes" text,
	"import_row_id" bigint,
	"handed_off_at" timestamp with time zone,
	"handed_off_by" text,
	"handoff_note" text,
	"resolution_outcome" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legacy_case_status" CHECK ("legacy_case"."legacy_status" IN ('open', 'closed')),
	CONSTRAINT "legacy_case_handoff_open_only" CHECK ("legacy_case"."handed_off_at" IS NULL OR ("legacy_case"."legacy_status" = 'open' AND "legacy_case"."handed_off_by" IS NOT NULL AND "legacy_case"."handoff_note" IS NOT NULL)),
	CONSTRAINT "legacy_case_resolved_after_handoff" CHECK ("legacy_case"."resolved_at" IS NULL OR ("legacy_case"."handed_off_at" IS NOT NULL AND "legacy_case"."resolution_outcome" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "legacy_case_note" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"author_user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legacy_case" ADD CONSTRAINT "legacy_case_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_case" ADD CONSTRAINT "legacy_case_import_row_id_import_row_id_fk" FOREIGN KEY ("import_row_id") REFERENCES "public"."import_row"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_case" ADD CONSTRAINT "legacy_case_handed_off_by_user_id_fk" FOREIGN KEY ("handed_off_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_case" ADD CONSTRAINT "legacy_case_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_case_note" ADD CONSTRAINT "legacy_case_note_case_id_legacy_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."legacy_case"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legacy_case_note" ADD CONSTRAINT "legacy_case_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_case_identity_unique" ON "legacy_case" USING btree ("shop_id","source_system","source_ref");--> statement-breakpoint
CREATE INDEX "legacy_case_shop_idx" ON "legacy_case" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "legacy_case_note_case_idx" ON "legacy_case_note" USING btree ("case_id");