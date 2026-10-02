-- Custom migration: row-level triggers do not fire on TRUNCATE, so audit_log needs a statement-level guard too.
CREATE OR REPLACE FUNCTION audit_log_no_truncate() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only: TRUNCATE is not allowed' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_no_truncate();
