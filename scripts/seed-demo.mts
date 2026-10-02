// Demo accounts, one per role, for the deployed demo. Runs from `vercel-build` after migrate.
// A no-op unless DEMO_ACCOUNTS_PASSWORD is set and APP_MODE=demo; refused when APP_MODE=live.
// Never prints the password, never creates a super admin, and signs the accounts out on every run.
const password = process.env.DEMO_ACCOUNTS_PASSWORD;
const mode = process.env.APP_MODE;

if (password && mode === "live") {
  console.error(
    "db:seed:demo: refusing to run with APP_MODE=live while DEMO_ACCOUNTS_PASSWORD is set.",
  );
  process.exit(1);
}
if (!password || mode !== "demo") {
  console.log("db:seed:demo: skipped (needs APP_MODE=demo and DEMO_ACCOUNTS_PASSWORD).");
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("db:seed:demo: DATABASE_URL is not set.");
  process.exit(1);
}

const DOMAIN = "demo.alnamer.invalid";
const ACCOUNTS = [
  { name: "Demo Student", email: `demo-student@${DOMAIN}`, role: "student" },
  { name: "Demo Parent", email: `demo-parent@${DOMAIN}`, role: "parent" },
  { name: "Demo Teacher", email: `demo-teacher@${DOMAIN}`, role: "teacher" },
  { name: "Demo Reviewer", email: `demo-reviewer@${DOMAIN}`, role: "reviewer" },
  { name: "Demo Admin", email: `demo-admin@${DOMAIN}`, role: "admin" },
] as const;

const { drizzle } = await import("drizzle-orm/postgres-js");
const { default: postgres } = await import("postgres");
const { upsertAccount } = await import("./lib/seed-accounts.mts");

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);
try {
  for (const account of ACCOUNTS) {
    // refresh: true also signs the account out everywhere (invalidateUserSessionsCore).
    await upsertAccount(db, account, { password, isSample: true, refresh: true });
  }
  console.log(`db:seed:demo: ${ACCOUNTS.length} demo accounts ready, sessions reset.`);
} catch (error) {
  console.error("db:seed:demo failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
// The app's own pool (opened by the session repo) would keep the process alive.
process.exit(process.exitCode ?? 0);
