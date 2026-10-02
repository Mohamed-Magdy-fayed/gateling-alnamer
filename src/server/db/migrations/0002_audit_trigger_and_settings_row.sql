-- Custom (data) migration: audit_log is append-only, and the single platform_settings row is seeded.
-- The one allowed UPDATE is the FK action ON DELETE SET NULL on actor_id (deleting a user must not be blocked).
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND NEW.actor_id IS NULL AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_log_immutable_trg
	BEFORE UPDATE OR DELETE ON "audit_log"
	FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();--> statement-breakpoint
INSERT INTO "platform_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
