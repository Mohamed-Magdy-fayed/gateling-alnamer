// Usage: node scripts/check-env.mjs <env-file>. Prints key NAMES only, never values.
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

const file = process.argv[2] ?? ".env";
const values = parse(readFileSync(file, "utf8"));
const has = (key) => Boolean(values[key]?.trim());
const required = ["DATABASE_URL"];
const recommended = [
  "BASE_URL",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL",
];
const missing = required.filter((k) => !has(k));
const missingRecommended = recommended.filter((k) => !has(k));
console.log(`${file}: required missing: ${missing.join(", ") || "none"}`);
console.log(`${file}: recommended missing: ${missingRecommended.join(", ") || "none"}`);
process.exit(missing.length ? 1 : 0);
