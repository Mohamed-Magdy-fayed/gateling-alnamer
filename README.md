# Al-Namer

Arabic-first learning marketplace for Gulf students, parents and teachers. This is the early client demo: real sign-up, sign-in and password reset; every other screen uses clearly labelled sample data.

## Local setup

Requires Node 24 and Docker Desktop.

```bash
npm ci
npm run setup   # env:init + docker compose up -d --wait + db:migrate + db:seed
npm run dev
```

`setup` writes a working `.env` from `.env.example` when none exists, starts Postgres, Redis, Mailpit and Inngest dev, migrates and seeds the four role accounts (`student@alnamer.local`, `parent@`, `teacher@`, `admin@`; the password is defined in `scripts/seed.mts`). Mailpit is at http://localhost:8025.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Next dev server on `.env`. |
| `npm run build:local` | Production build forced onto `.env`; refuses a non-local `DATABASE_URL`. |
| `npm run start:local` | `next start` forced onto `.env`; same guard. |
| `npm run <script> -- --test-db` | `build:local`, `start:local`, `db:migrate`, `db:seed` and `setup` accept `--test-db`: use the throwaway `db-test` container (`TEST_DATABASE_URL`, default `postgres://alnamer_test:alnamer_test@localhost:5433/alnamer_test`) instead of the `.env` database. |
| `npm run check` | Typecheck + Biome. |
| `npm test` | Vitest unit tests. |
| `npm run smoke` | Playwright smoke test of the demo journeys on `start:local --test-db` (needs `db-test` and Mailpit up). |
| `npm run verify` | `check` + `test` + `build:local --test-db`. Run before every push. |
| `npm run setup` | One-shot local setup (see above). |
| `npm run env:init` | Create `.env` from `.env.example`, or append the missing keys (prints key names only). |
| `npm run db:up` | `docker compose up -d --wait`. |
| `npm run db:generate` | Generate a Drizzle migration from the schema. Never hand-write one. |
| `npm run db:migrate` | Apply migrations (local-database guard on). |
| `npm run db:seed` | Upsert the role accounts (refused on Vercel and on non-local databases). |
| `npm run check:env` | Report which env keys are set (names only); `-- --markdown` writes `docs-public/env.md`. |

Never run a plain `next build` locally while `.env.production.local` exists: Next would load the real Production credentials. `build:local` prevents that.

## Deploy (Vercel)

`vercel-build` runs `scripts/migrate.mts` (generated Drizzle migrations, table `__alnamer_migrations`) and then `next build`. `APP_MODE` is required (`demo` for the client demo). Needed env vars: `APP_MODE`, `DATABASE_URL`, `BASE_URL`, `SMTP_*`; see `docs-public/env.md` for every key.
