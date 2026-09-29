CREATE TABLE "operator_item" (
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"owner_user_id" text,
	"assigned_at" timestamp with time zone,
	"assigned_by" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"review_note" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_item_subject_type_subject_id_pk" PRIMARY KEY("subject_type","subject_id"),
	CONSTRAINT "operator_item_subject_type" CHECK ("operator_item"."subject_type" IN ('invitation', 'email_intent', 'survey_response', 'suppression_action', 'worker_job', 'worker')),
	CONSTRAINT "operator_item_review_complete" CHECK ("operator_item"."reviewed_at" IS NULL OR ("operator_item"."reviewed_by" IS NOT NULL AND "operator_item"."review_note" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "operator_item" ADD CONSTRAINT "operator_item_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_item" ADD CONSTRAINT "operator_item_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_item" ADD CONSTRAINT "operator_item_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_item_owner_idx" ON "operator_item" USING btree ("owner_user_id") WHERE "operator_item"."owner_user_id" is not null;