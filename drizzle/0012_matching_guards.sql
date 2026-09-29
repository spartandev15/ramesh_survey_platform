-- Existing submitted responses came from token links, so each is the first
-- and only submission for its invitation: it is the counted (canonical) one.
UPDATE survey_response SET canonical = true WHERE status = 'submitted' AND source = 'online';
--> statement-breakpoint
-- Matching decisions are evidence: they are appended, never edited (PDF: MatchDecision).
CREATE FUNCTION match_decision_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'match_decision is append-only (% not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER match_decision_append_only
  BEFORE UPDATE OR DELETE ON match_decision
  FOR EACH ROW EXECUTE FUNCTION match_decision_append_only();
--> statement-breakpoint
-- A response's visit must belong to its shop and share its test flag (SR-03, AT-01).
CREATE FUNCTION survey_response_visit_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_shop uuid;
  v_is_test boolean;
BEGIN
  IF NEW.visit_id IS NOT NULL THEN
    SELECT shop_id, is_test INTO v_shop, v_is_test FROM repair_visit WHERE id = NEW.visit_id;
    IF v_shop IS DISTINCT FROM NEW.shop_id OR v_is_test IS DISTINCT FROM NEW.is_test THEN
      RAISE EXCEPTION 'a response must match its repair visit shop and test flag'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER survey_response_visit_consistency
  BEFORE INSERT OR UPDATE OF visit_id, shop_id, is_test ON survey_response
  FOR EACH ROW EXECUTE FUNCTION survey_response_visit_consistency();
