// Usage: node scripts/env-init.mjs. Creates .env from .env.example when missing, otherwise
// appends the keys .env lacks. Compares key names only; prints names, never values.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

const example = ".env.example";
const target = ".env";

if (!existsSync(target)) {
  writeFileSync(target, readFileSync(example, "utf8"));
  console.log(`${target} created from ${example}`);
  process.exit(0);
}

const present = new Set(Object.keys(parse(readFileSync(target, "utf8"))));
const lines = readFileSync(example, "utf8").split(/\r?\n/);
const added = [];
const block = [];
let comments = [];
for (const line of lines) {
  const key = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
  if (!key) {
    comments = line.startsWith("#") ? [...comments, line] : [];
    continue;
  }
  if (!present.has(key)) {
    block.push(...comments, line);
    added.push(key);
  }
  comments = [];
}

if (added.length === 0) {
  console.log(`${target} already has every key from ${example}`);
  process.exit(0);
}
const current = readFileSync(target, "utf8");
const separator = current.endsWith("\n") ? "" : "\n";
writeFileSync(target, `${current}${separator}${block.join("\n")}\n`);
console.log(`${target}: added ${added.join(", ")}`);
