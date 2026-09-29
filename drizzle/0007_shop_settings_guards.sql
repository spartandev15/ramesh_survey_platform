-- Every existing shop gets its survey settings row, starting in Test mode.
INSERT INTO shop_survey_settings (shop_id)
SELECT id FROM shop
ON CONFLICT (shop_id) DO NOTHING;
--> statement-breakpoint
-- Guards that must hold however the row is written (SR-03, SR-15, AT-14):
-- only a published version can be assigned, and outside Test mode that version
-- must be verified content and the shop must not be an internal test shop.
CREATE FUNCTION shop_survey_settings_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status instrument_version_status;
  v_is_test boolean;
  s_is_test_shop boolean;
BEGIN
  IF NEW.instrument_version_id IS NOT NULL THEN
    SELECT status, is_test INTO v_status, v_is_test FROM instrument_version WHERE id = NEW.instrument_version_id;
    IF v_status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'only a published survey version can be assigned to a shop'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.mode <> 'test' THEN
    SELECT is_test_shop INTO s_is_test_shop FROM shop WHERE id = NEW.shop_id;
    IF s_is_test_shop THEN
      RAISE EXCEPTION 'an internal test shop cannot leave Test mode'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_is_test THEN
      RAISE EXCEPTION 'a TEST survey version cannot be used outside Test mode'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER shop_survey_settings_guard
  BEFORE INSERT OR UPDATE ON shop_survey_settings
  FOR EACH ROW EXECUTE FUNCTION shop_survey_settings_guard();
