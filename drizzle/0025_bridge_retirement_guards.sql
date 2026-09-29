-- A signed bridge retirement is history (SR-47, AT-47): never changed or deleted.
CREATE TRIGGER bridge_retirement_append_only BEFORE UPDATE OR DELETE ON bridge_retirement FOR EACH ROW EXECUTE FUNCTION reject_history_change();
--> statement-breakpoint
-- A dependency is part of the retirement evidence: it can change state but never disappear.
CREATE FUNCTION bridge_dependency_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'bridge dependencies cannot be deleted; mark them retired instead' USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER bridge_dependency_no_delete BEFORE DELETE ON bridge_dependency FOR EACH ROW EXECUTE FUNCTION bridge_dependency_no_delete();
