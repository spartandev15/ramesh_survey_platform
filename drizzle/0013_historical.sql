CREATE TABLE "historical_response" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"source_ref" text NOT NULL,
	"responded_on" date NOT NULL,
	"measures" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historical_response_source_unique" UNIQUE("source_system","source_ref")
);
--> statement-breakpoint
ALTER TABLE "historical_response" ADD CONSTRAINT "historical_response_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "historical_response_shop_idx" ON "historical_response" USING btree ("shop_id","responded_on");