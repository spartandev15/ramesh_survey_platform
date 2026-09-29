-- Legacy case handoff (SR-46). A legacy case is never deleted. Once PSG hands
-- it off to Hub, what the legacy system said and who took it over are fixed,
-- so a later import cannot overwrite Hub follow-up, and a resolution stands.
CREATE FUNCTION legacy_case_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legacy cases cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.shop_id IS DISTINCT FROM OLD.shop_id OR NEW.source_system IS DISTINCT FROM OLD.source_system OR NEW.source_ref IS DISTINCT FROM OLD.source_ref THEN
    RAISE EXCEPTION 'the identity of a legacy case cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.handed_off_at IS NOT NULL AND (
    NEW.legacy_status IS DISTINCT FROM OLD.legacy_status OR
    NEW.opened_on IS DISTINCT FROM OLD.opened_on OR
    NEW.summary IS DISTINCT FROM OLD.summary OR
    NEW.legacy_owner IS DISTINCT FROM OLD.legacy_owner OR
    NEW.visit_key IS DISTINCT FROM OLD.visit_key OR
    NEW.customer_name IS DISTINCT FROM OLD.customer_name OR
    NEW.response_ref IS DISTINCT FROM OLD.response_ref OR
    NEW.legacy_notes IS DISTINCT FROM OLD.legacy_notes OR
    NEW.handed_off_at IS DISTINCT FROM OLD.handed_off_at OR
    NEW.handed_off_by IS DISTINCT FROM OLD.handed_off_by OR
    NEW.handoff_note IS DISTINCT FROM OLD.handoff_note
  ) THEN
    RAISE EXCEPTION 'a legacy case handed off to Hub keeps its legacy record and handoff unchanged' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.resolved_at IS NOT NULL AND (
    NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by OR NEW.resolution_outcome IS DISTINCT FROM OLD.resolution_outcome
  ) THEN
    RAISE EXCEPTION 'a resolved legacy case stays resolved' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legacy_case_guard BEFORE UPDATE OR DELETE ON legacy_case FOR EACH ROW EXECUTE FUNCTION legacy_case_guard();
--> statement-breakpoint
CREATE TRIGGER legacy_case_note_append_only BEFORE UPDATE OR DELETE ON legacy_case_note FOR EACH ROW EXECUTE FUNCTION reject_history_change();
