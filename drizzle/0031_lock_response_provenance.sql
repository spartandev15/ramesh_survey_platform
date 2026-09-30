-- Paper and public provenance is part of what was submitted (SR-17, SR-18):
-- once a response is submitted, the date the paper form was received, who
-- entered it and the details the respondent gave can no longer change.
-- Matching state stays updatable; corrections append to response_revision.
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
    NEW.is_test IS DISTINCT FROM OLD.is_test OR
    NEW.received_on IS DISTINCT FROM OLD.received_on OR
    NEW.entered_by IS DISTINCT FROM OLD.entered_by OR
    NEW.respondent_context IS DISTINCT FROM OLD.respondent_context
  ) THEN
    RAISE EXCEPTION 'submitted response answers are locked' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
