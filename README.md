# Al-Namer

Arabic-first learning marketplace for Gulf students, parents and teachers. This is the early client demo: real sign-up, sign-in and password reset; every other screen uses clearly labelled sample data.

## Local setup

Requires Node 22+ and Docker Desktop.

```bash
npm ci
cp .env.example .env   # fill DATABASE_URL and DB_*
npm run db:up          # Postgres + Mailpit (http://localhost:8025)
npm run db:migrate
npm run dev
```

## Gates

```bash
npm run check          # typecheck + Biome
npm run build:local    # production build forced onto .env
```

Never run a plain `next build` locally while `.env.production.local` exists: Next would load the real Production credentials. `build:local` prevents that.

## Deploy (Vercel)

`vercel-build` runs `scripts/migrate.mts` (generated Drizzle migrations, table `__alnamer_migrations`) and then `next build`. Needed env vars: `DATABASE_URL`, `BASE_URL`, `SMTP_*`.
