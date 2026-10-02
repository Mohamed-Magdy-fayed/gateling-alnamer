# Recipe: write a data migration

Schema changes are generated (`npm run db:generate`). Only changes to existing **data** (backfills, seed rows, triggers, type conversions) are written by hand.

## Steps
1. Generate an empty migration: `npx drizzle-kit generate --custom --name <name>`.
2. Write the SQL in the new file under `src/server/db/migrations/`.
3. Commit the `.sql`, the `meta/` snapshot and `_journal.json` together.
4. Apply: `npm run db:migrate` (or `-- --test-db`). Integration tests run migrations on a fresh database, so a broken one fails `npm run test:int`.

## Example
`src/server/db/migrations/0002_audit_trigger_and_settings_row.sql` ends with a seed row:

```sql
INSERT INTO "platform_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
```

## Test first
Add or extend an integration test (`*.int.test.ts`) that asserts the end state after migrating (the row exists, the trigger rejects the bad write). Watch it fail, then write the SQL.

## Rules
- Seed rows use fixed UUIDs (or fixed ids) and `ON CONFLICT DO NOTHING`, so re-runs and every environment end up identical.
- Expand/contract: ship additive changes first (new nullable column, backfill), move the code over, drop the old column in a later migration. Never rename or drop in the same release the code still reads it.
- Never edit an applied migration. Fix forward with a new one.
- Never `db:push` instead of a migration.
