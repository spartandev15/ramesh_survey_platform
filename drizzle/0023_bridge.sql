CREATE TABLE "bridge_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_version" integer NOT NULL,
	"shop_id" uuid,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"overwrite_approved_by" text,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridge_event_entity_type" CHECK ("bridge_event"."entity_type" IN ('response', 'case', 'suppression')),
	CONSTRAINT "bridge_event_state" CHECK ("bridge_event"."state" IN ('pending', 'retrying', 'failed', 'conflict', 'confirmed', 'superseded')),
	CONSTRAINT "bridge_event_confirmed" CHECK (("bridge_event"."state" = 'confirmed') = ("bridge_event"."confirmed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "bridge_gate" (
	"item" text PRIMARY KEY NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "bridge_gate_item" CHECK ("bridge_gate"."item" IN ('field_map', 'alert_exclusion', 'sandbox_test', 'writes_enabled'))
);
--> statement-breakpoint
CREATE TABLE "bridge_mapping" (
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"confirmed_version" integer NOT NULL,
	"confirmed_hash" text NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bridge_mapping_entity_type_entity_id_pk" PRIMARY KEY("entity_type","entity_id"),
	CONSTRAINT "bridge_mapping_external_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "bridge_event" ADD CONSTRAINT "bridge_event_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_event" ADD CONSTRAINT "bridge_event_overwrite_approved_by_user_id_fk" FOREIGN KEY ("overwrite_approved_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bridge_gate" ADD CONSTRAINT "bridge_gate_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_event_version_unique" ON "bridge_event" USING btree ("entity_type","entity_id","entity_version");--> statement-breakpoint
CREATE INDEX "bridge_event_due_idx" ON "bridge_event" USING btree ("next_attempt_at") WHERE "bridge_event"."state" IN ('pending', 'retrying');--> statement-breakpoint
CREATE INDEX "bridge_event_state_idx" ON "bridge_event" USING btree ("state");