-- Submitted answers are locked (SR-17). Once a response is submitted, the
-- columns that define what was answered can never change, and the response
-- cannot be deleted. Other columns (for example future matching state) stay
-- updatable. Corrections append to response_revision (SR-20).
CREATE FUNCTION survey_response_lock_submitted() RETURNS trigger
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
CREATE TRIGGER survey_response_locked_after_submit
  BEFORE UPDATE OR DELETE ON survey_response
  FOR EACH ROW EXECUTE FUNCTION survey_response_lock_submitted();
--> statement-breakpoint
-- Answer history is append-only, like audit_event.
CREATE FUNCTION response_revision_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'response_revision is append-only (% not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER response_revision_no_update_delete
  BEFORE UPDATE OR DELETE ON response_revision
  FOR EACH ROW EXECUTE FUNCTION response_revision_reject_change();
--> statement-breakpoint
CREATE TRIGGER response_revision_no_truncate
  BEFORE TRUNCATE ON response_revision
  FOR EACH STATEMENT EXECUTE FUNCTION response_revision_reject_change();
