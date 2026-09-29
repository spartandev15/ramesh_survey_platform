-- Test and production records never mix (SR-03, AT-03): an invitation has the
-- same test flag as its repair visit and shop-scoped identity, and an email
-- intent has the same test flag as its invitation.
CREATE FUNCTION invitation_visit_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_shop uuid;
  v_is_test boolean;
BEGIN
  IF NEW.visit_id IS NOT NULL THEN
    SELECT shop_id, is_test INTO v_shop, v_is_test FROM repair_visit WHERE id = NEW.visit_id;
    IF v_shop IS DISTINCT FROM NEW.shop_id OR v_is_test IS DISTINCT FROM NEW.is_test THEN
      RAISE EXCEPTION 'an invitation must match its repair visit shop and test flag'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.is_test IS DISTINCT FROM OLD.is_test OR NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.visit_id IS DISTINCT FROM OLD.visit_id) THEN
    RAISE EXCEPTION 'an invitation cannot change shop, visit or test flag'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER invitation_visit_consistency
  BEFORE INSERT OR UPDATE ON invitation
  FOR EACH ROW EXECUTE FUNCTION invitation_visit_consistency();
--> statement-breakpoint
CREATE FUNCTION email_intent_test_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  i_is_test boolean;
BEGIN
  SELECT is_test INTO i_is_test FROM invitation WHERE id = NEW.invitation_id;
  IF i_is_test IS DISTINCT FROM NEW.is_test THEN
    RAISE EXCEPTION 'an email intent must match its invitation test flag'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_intent_test_consistency
  BEFORE INSERT OR UPDATE ON email_intent
  FOR EACH ROW EXECUTE FUNCTION email_intent_test_consistency();
--> statement-breakpoint
-- Legacy evidence is read-only once loaded (SR-08): no override or bypass.
CREATE FUNCTION legacy_survey_ledger_read_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'legacy survey ledger rows are read-only (% not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legacy_survey_ledger_read_only
  BEFORE UPDATE OR DELETE ON legacy_survey_ledger
  FOR EACH ROW EXECUTE FUNCTION legacy_survey_ledger_read_only();
--> statement-breakpoint
CREATE TRIGGER legacy_survey_ledger_no_truncate
  BEFORE TRUNCATE ON legacy_survey_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION legacy_survey_ledger_read_only();
