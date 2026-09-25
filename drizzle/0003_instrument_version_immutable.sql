-- Published instrument versions are immutable (SR-15, AT-15): invitations and
-- responses are pinned to them, so their questions, scoring and alert rules
-- must never change. Drafts stay editable; publishing is the draft -> published
-- update itself. Edits after publication create a new version.
CREATE FUNCTION instrument_version_reject_published_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' OR OLD.status = 'published' THEN
    RAISE EXCEPTION 'published instrument versions are immutable (% not allowed)', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER instrument_version_published_immutable
  BEFORE UPDATE OR DELETE ON instrument_version
  FOR EACH ROW EXECUTE FUNCTION instrument_version_reject_published_change();
--> statement-breakpoint
CREATE TRIGGER instrument_version_no_truncate
  BEFORE TRUNCATE ON instrument_version
  FOR EACH STATEMENT EXECUTE FUNCTION instrument_version_reject_published_change();
