// Usage: node scripts/check-env.mjs [env-file]   prints key NAMES only, never values.
//        node scripts/check-env.mjs --markdown     writes docs-public/env.md from .env.example.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { renderEnvMarkdown } from "./lib/env-docs.mjs";

const args = process.argv.slice(2);

if (args.includes("--markdown")) {
  const example = path.join(import.meta.dirname, "..", ".env.example");
  const out = path.join(process.cwd(), "docs-public", "env.md");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, renderEnvMarkdown(readFileSync(example, "utf8")));
  console.log(`wrote ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}

const file = args[0] ?? ".env";
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
