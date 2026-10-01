// Usage: node scripts/env-init.mjs. Creates .env from .env.example when missing, otherwise
// appends the keys .env lacks. Compares key names only; prints names, never values.
// Secret keys are generated (32 random bytes, base64) so a fresh clone works without edits.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

const example = path.join(import.meta.dirname, "..", ".env.example");
const target = path.join(process.cwd(), ".env");
const GENERATED = ["IBAN_ENCRYPTION_KEY", "TOTP_ENCRYPTION_KEY", "DEVICE_COOKIE_SECRET"];
const REDIS_TOKEN = "LOCAL_REDIS_TOKEN";
const REDIS_REST_TOKEN = "UPSTASH_REDIS_REST_TOKEN";
const secret = () => randomBytes(32).toString("base64");

// The REST token must match the token the local proxy accepts, so both share one value.
const redisToken = secret();
const generated = {
  ...Object.fromEntries(GENERATED.map((key) => [key, secret()])),
  [REDIS_TOKEN]: redisToken,
  [REDIS_REST_TOKEN]: redisToken,
};

function fill(line, key, existing) {
  const value = generated[key];
  if (value === undefined) return line;
  if (key === REDIS_REST_TOKEN && existing[REDIS_TOKEN]) return `${key}=${existing[REDIS_TOKEN]}`;
  return `${key}=${value}`;
}

const present = existsSync(target) ? parse(readFileSync(target, "utf8")) : {};
const created = !existsSync(target);
const added = [];
const block = [];
let comments = [];
for (const line of readFileSync(example, "utf8").split(/\r?\n/)) {
  const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
  if (!key) {
    comments = line.startsWith("#") ? [...comments, line] : [];
    continue;
  }
  if (!(key in present)) {
    block.push(...comments, fill(line, key, present));
    added.push(key);
  }
  comments = [];
}

if (created) {
  writeFileSync(target, `${block.join("\n")}\n`);
  console.log(`${path.basename(target)} created from .env.example`);
  process.exit(0);
}
if (added.length === 0) {
  console.log(`${path.basename(target)} already has every key from .env.example`);
  process.exit(0);
}
const current = readFileSync(target, "utf8");
const separator = current.endsWith("\n") ? "" : "\n";
writeFileSync(target, `${current}${separator}${block.join("\n")}\n`);
console.log(`${path.basename(target)}: added ${added.join(", ")}`);
