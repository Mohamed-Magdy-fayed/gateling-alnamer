-- Custom migration: audit_log is strictly append-only. Deleting a user with audit rows is now blocked by the
-- actor_id FK (ON DELETE RESTRICT), so the old ON DELETE SET NULL exception is gone: every UPDATE and DELETE raises.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
