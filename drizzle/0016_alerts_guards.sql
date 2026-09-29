-- An email intent keeps the test flag of what it belongs to: its invitation,
-- or for alert emails, its case (SR-03, AT-03).
CREATE OR REPLACE FUNCTION email_intent_test_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_is_test boolean;
BEGIN
  IF NEW.invitation_id IS NOT NULL THEN
    SELECT is_test INTO owner_is_test FROM invitation WHERE id = NEW.invitation_id;
  ELSE
    SELECT c.is_test INTO owner_is_test FROM alert_approval a JOIN alert_case c ON c.id = a.case_id WHERE a.id = NEW.alert_approval_id;
  END IF;
  IF owner_is_test IS DISTINCT FROM NEW.is_test THEN
    RAISE EXCEPTION 'an email intent must match the test flag of what it belongs to'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Approvals (reviewer and recipient snapshot) and case notes are history: append-only (SR-33, SR-34).
CREATE FUNCTION reject_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER alert_approval_append_only BEFORE UPDATE OR DELETE ON alert_approval FOR EACH ROW EXECUTE FUNCTION reject_history_change();
--> statement-breakpoint
CREATE TRIGGER case_note_append_only BEFORE UPDATE OR DELETE ON case_note FOR EACH ROW EXECUTE FUNCTION reject_history_change();
--> statement-breakpoint
-- An acknowledged suppression change stays acknowledged; a reversal is a new action (AT-36).
CREATE FUNCTION suppression_action_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'suppression actions cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'acknowledged' THEN
    RAISE EXCEPTION 'an acknowledged suppression action cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.response_id IS DISTINCT FROM OLD.response_id OR NEW.rule_id IS DISTINCT FROM OLD.rule_id OR NEW.desired IS DISTINCT FROM OLD.desired OR NEW.source_revision IS DISTINCT FROM OLD.source_revision THEN
    RAISE EXCEPTION 'the required change of a suppression action cannot be edited' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER suppression_action_guard BEFORE UPDATE OR DELETE ON suppression_action FOR EACH ROW EXECUTE FUNCTION suppression_action_guard();
