-- Shop additions (SR-45): a shop's own questions live in an instrument owned
-- by that shop. These guards keep the shared core and each shop's additions
-- apart however the rows are written.

-- A submitted response's addition version is locked with its other answers (SR-17).
CREATE OR REPLACE FUNCTION survey_response_lock_submitted() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'submitted' THEN
      RAISE EXCEPTION 'submitted responses cannot be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'submitted' AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.draft_answers IS DISTINCT FROM OLD.draft_answers OR
    NEW.draft_revision IS DISTINCT FROM OLD.draft_revision OR
    NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR
    NEW.submit_request_key IS DISTINCT FROM OLD.submit_request_key OR
    NEW.submit_payload_hash IS DISTINCT FROM OLD.submit_payload_hash OR
    NEW.instrument_version_id IS DISTINCT FROM OLD.instrument_version_id OR
    NEW.addition_version_id IS DISTINCT FROM OLD.addition_version_id OR
    NEW.invitation_id IS DISTINCT FROM OLD.invitation_id OR
    NEW.source IS DISTINCT FROM OLD.source OR
    NEW.is_test IS DISTINCT FROM OLD.is_test
  ) THEN
    RAISE EXCEPTION 'submitted response answers are locked' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Settings: the core slot holds only a shared-core version; the addition slot
-- only this shop's own published addition, and outside Test mode never TEST content.
CREATE OR REPLACE FUNCTION shop_survey_settings_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status instrument_version_status;
  v_is_test boolean;
  v_owner uuid;
  a_status instrument_version_status;
  a_is_test boolean;
  a_owner uuid;
  s_is_test_shop boolean;
BEGIN
  IF NEW.instrument_version_id IS NOT NULL THEN
    SELECT v.status, v.is_test, i.shop_id INTO v_status, v_is_test, v_owner
      FROM instrument_version v JOIN instrument i ON i.id = v.instrument_id WHERE v.id = NEW.instrument_version_id;
    IF v_status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'only a published survey version can be assigned to a shop' USING ERRCODE = 'check_violation';
    END IF;
    IF v_owner IS NOT NULL THEN
      RAISE EXCEPTION 'shop questions cannot be assigned as the core survey' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.addition_version_id IS NOT NULL THEN
    SELECT v.status, v.is_test, i.shop_id INTO a_status, a_is_test, a_owner
      FROM instrument_version v JOIN instrument i ON i.id = v.instrument_id WHERE v.id = NEW.addition_version_id;
    IF a_status IS DISTINCT FROM 'published' THEN
      RAISE EXCEPTION 'only published shop questions can be assigned' USING ERRCODE = 'check_violation';
    END IF;
    IF a_owner IS DISTINCT FROM NEW.shop_id THEN
      RAISE EXCEPTION 'a shop can only use its own additional questions' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.mode <> 'test' THEN
    SELECT is_test_shop INTO s_is_test_shop FROM shop WHERE id = NEW.shop_id;
    IF s_is_test_shop THEN
      RAISE EXCEPTION 'an internal test shop cannot leave Test mode' USING ERRCODE = 'check_violation';
    END IF;
    IF v_is_test OR a_is_test THEN
      RAISE EXCEPTION 'a TEST survey version cannot be used outside Test mode' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Invitations and responses pin a core version and, optionally, their own shop's addition.
CREATE FUNCTION survey_versions_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  core_owner uuid;
  add_owner uuid;
BEGIN
  SELECT i.shop_id INTO core_owner FROM instrument_version v JOIN instrument i ON i.id = v.instrument_id WHERE v.id = NEW.instrument_version_id;
  IF core_owner IS NOT NULL THEN
    RAISE EXCEPTION 'shop questions cannot be the core survey' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.addition_version_id IS NOT NULL THEN
    SELECT i.shop_id INTO add_owner FROM instrument_version v JOIN instrument i ON i.id = v.instrument_id WHERE v.id = NEW.addition_version_id;
    IF add_owner IS NULL OR (NEW.shop_id IS NOT NULL AND add_owner <> NEW.shop_id) THEN
      RAISE EXCEPTION 'additional questions must belong to the same shop' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitation_versions_consistency BEFORE INSERT OR UPDATE OF instrument_version_id, addition_version_id, shop_id ON invitation
  FOR EACH ROW EXECUTE FUNCTION survey_versions_consistency();
--> statement-breakpoint
CREATE TRIGGER survey_response_versions_consistency BEFORE INSERT OR UPDATE OF instrument_version_id, addition_version_id, shop_id ON survey_response
  FOR EACH ROW EXECUTE FUNCTION survey_versions_consistency();
--> statement-breakpoint
-- A survey never moves between the core and a shop, or between shops.
CREATE FUNCTION instrument_owner_fixed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shop_id IS DISTINCT FROM OLD.shop_id THEN
    RAISE EXCEPTION 'the owner of a survey cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER instrument_owner_fixed BEFORE UPDATE OF shop_id ON instrument FOR EACH ROW EXECUTE FUNCTION instrument_owner_fixed();
