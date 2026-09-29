CREATE TABLE "shop_readiness" (
	"shop_id" uuid NOT NULL,
	"item" text NOT NULL,
	"confirmed_by" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text NOT NULL,
	CONSTRAINT "shop_readiness_shop_id_item_pk" PRIMARY KEY("shop_id","item"),
	CONSTRAINT "shop_readiness_item" CHECK ("shop_readiness"."item" IN ('mapping', 'branding', 'history', 'opt_outs', 'internal_test', 'acceptance'))
);
--> statement-breakpoint
ALTER TABLE "shop_readiness" ADD CONSTRAINT "shop_readiness_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_readiness" ADD CONSTRAINT "shop_readiness_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;