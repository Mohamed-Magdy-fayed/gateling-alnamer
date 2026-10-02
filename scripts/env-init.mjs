// Usage: node scripts/env-init.mjs. Creates .env from .env.example when missing, otherwise
// appends the keys .env lacks. Compares key names only; prints names, never values.
// Secret keys are generated (32 random bytes, base64) so a fresh clone works without edits.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

const example = path.join(import.meta.dirname, "..", ".env.example");
const target = path.join(process.cwd(), ".env");
const GENERATED = [
  "IBAN_ENCRYPTION_KEY",
  "TOTP_ENCRYPTION_KEY",
  "DEVICE_COOKIE_SECRET",
  "INNGEST_ENCRYPTION_KEY",
];
const REDIS_TOKEN = "LOCAL_REDIS_TOKEN";
const REDIS_REST_TOKEN = "UPSTASH_REDIS_REST_TOKEN";
const secret = () => randomBytes(32).toString("base64");

const existingText = existsSync(target) ? readFileSync(target, "utf8") : "";
const BLANK_LINE = /^([A-Z][A-Z0-9_]*)=[^\S\r\n]*(?:""|'')?[^\S\r\n]*(?=\r?$)/gm;
// dotenv's parse drops some blank assignments, so blanks are read from the raw lines.
const blankKeys = new Set([...existingText.matchAll(BLANK_LINE)].map((match) => match[1]));
const present = {
  ...Object.fromEntries([...blankKeys].map((key) => [key, ""])),
  ...parse(existingText),
};

// The REST token must match the token the local proxy accepts, so both share one value:
// an existing non-blank one wins, in either direction.
const redisToken = present[REDIS_TOKEN] || present[REDIS_REST_TOKEN] || secret();
const generated = {
  ...Object.fromEntries(GENERATED.map((key) => [key, secret()])),
  [REDIS_TOKEN]: redisToken,
  [REDIS_REST_TOKEN]: redisToken,
};

// A generated key that is present but blank counts as missing.
const isMissing = (key) => !(key in present) || (key in generated && !present[key]);

function fill(line, key) {
  const value = generated[key];
  return value === undefined ? line : `${key}=${value}`;
}

const created = !existsSync(target);
const added = [];
const block = [];
const blanks = [];
let comments = [];
for (const line of readFileSync(example, "utf8").split(/\r?\n/)) {
  const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
  if (!key) {
    comments = line.startsWith("#") ? [...comments, line] : [];
    continue;
  }
  if (isMissing(key)) {
    if (key in present) blanks.push(key);
    else block.push(...comments, fill(line, key));
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
// Blank generated keys are filled where they stand; absent keys are appended.
const current = existingText.replace(BLANK_LINE, (line, key) =>
  blanks.includes(key) ? `${key}=${generated[key]}` : line,
);
const separator = current.endsWith("\n") ? "" : "\n";
const appended = block.length > 0 ? `${block.join("\n")}\n` : "";
writeFileSync(target, `${current}${separator}${appended}`);
console.log(`${path.basename(target)}: added ${added.join(", ")}`);
