-- Historical responses are read-only reference records once loaded (SR-30, AT-30).
CREATE FUNCTION historical_response_read_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'historical responses are read-only (% not allowed)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER historical_response_read_only
  BEFORE UPDATE OR DELETE ON historical_response
  FOR EACH ROW EXECUTE FUNCTION historical_response_read_only();
--> statement-breakpoint
CREATE TRIGGER historical_response_no_truncate
  BEFORE TRUNCATE ON historical_response
  FOR EACH STATEMENT EXECUTE FUNCTION historical_response_read_only();
