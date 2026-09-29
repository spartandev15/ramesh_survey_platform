CREATE TABLE "bridge_dependency" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"uses" text NOT NULL,
	"status" text DEFAULT 'in_use' NOT NULL,
	"outcome" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_dependency_name_unique" UNIQUE("name"),
	CONSTRAINT "bridge_dependency_status" CHECK ("bridge_dependency"."status" IN ('in_use', 'replaced', 'retired')),
	CONSTRAINT "bridge_dependency_outcome" CHECK ("bridge_dependency"."status" = 'in_use' OR "bridge_dependency"."outcome" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bridge_retirement" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"signed_by" text NOT NULL,
	"file_maker_owner" text NOT NULL,
	"note" text NOT NULL,
	"dependencies" jsonb NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_dependency" ADD CONSTRAINT "bridge_dependency_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_retirement" ADD CONSTRAINT "bridge_retirement_signed_by_user_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;