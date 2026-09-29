ALTER TABLE "instrument" ADD COLUMN "shop_id" uuid;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "addition_version_id" uuid;--> statement-breakpoint
ALTER TABLE "shop_survey_settings" ADD COLUMN "addition_version_id" uuid;--> statement-breakpoint
ALTER TABLE "survey_response" ADD COLUMN "addition_version_id" uuid;--> statement-breakpoint
ALTER TABLE "instrument" ADD CONSTRAINT "instrument_shop_id_shop_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shop"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_addition_version_id_instrument_version_id_fk" FOREIGN KEY ("addition_version_id") REFERENCES "public"."instrument_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_survey_settings" ADD CONSTRAINT "shop_survey_settings_addition_version_id_instrument_version_id_fk" FOREIGN KEY ("addition_version_id") REFERENCES "public"."instrument_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_response" ADD CONSTRAINT "survey_response_addition_version_id_instrument_version_id_fk" FOREIGN KEY ("addition_version_id") REFERENCES "public"."instrument_version"("id") ON DELETE no action ON UPDATE no action;