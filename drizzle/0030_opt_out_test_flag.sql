DROP INDEX "shop_opt_out_unique";--> statement-breakpoint
ALTER TABLE "shop_opt_out" ADD COLUMN "is_test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_opt_out_unique" ON "shop_opt_out" USING btree ("shop_id","email_normalized","is_test");