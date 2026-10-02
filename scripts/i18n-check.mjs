// i18n:check — fails on unused dictionary leaves, used-but-missing paths, en/ar leaf-set drift,
// and bracket accesses (`t.group[key]`) whose root is not listed in src/i18n/dynamic-keys.ts.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PLURAL_KEYS = ["zero", "one", "two", "few", "many", "other"];
const IDENT = String.raw`[A-Za-z_$][\w$]*`;
const DOTTED = String.raw`${IDENT}(?:\.${IDENT})*`;

function isPlural(value) {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => PLURAL_KEYS.includes(k)) && keys.includes("other");
}

/** Every leaf path. Strings, arrays and plural objects each count as one leaf. */
export function listLeaves(node, prefix = "") {
  const leaves = [];
  for (const [key, value] of Object.entries(node)) {
    const here = prefix ? `${prefix}.${key}` : key;
    const isBranch =
      typeof value === "object" && value !== null && !Array.isArray(value) && !isPlural(value);
    if (isBranch) leaves.push(...listLeaves(value, here));
    else leaves.push(here);
  }
  return leaves;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const aliasNames = (bases) => [...bases.keys()].map(escapeRe).join("|");

/**
 * Drops comments and the contents of string literals so a key mentioned in either is not counted
 * as a use. A string right after `[` is kept (`Dictionary["auth"]`). Template literals are kept as
 * code (their `${}` holes can use keys) but are protected from comment detection. Quote strings
 * end at a newline, so an apostrophe in JSX text cannot swallow the rest of the file.
 */
export function stripNonCode(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i += 1) if (source[i] === "\n") out += "\n";
    } else if (ch === "`") {
      const start = i;
      i += 1;
      while (i < source.length && source[i] !== "`") i += source[i] === "\\" ? 2 : 1;
      i += 1;
      out += source.slice(start, i);
    } else if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < source.length && source[i] !== ch && source[i] !== "\n") {
        i += source[i] === "\\" ? 2 : 1;
      }
      if (source[i] === ch) i += 1;
      out += out.endsWith("[") ? source.slice(start, i) : `${ch}${ch}`;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

function join(base, rest) {
  return base ? `${base}.${rest}` : rest;
}

/**
 * Static dictionary accesses in one source file. Supported:
 *  - `t.a.b`, also `dictionary.` / `dict.`; `t.a.b[key]` is a dynamic access on `a.b`
 *  - aliases: `const d = t.a.b;` and `const { x, y } = t.a.b;` (then `d.x`, `x`)
 *  - a prop typed from a sub-tree: `type T = Dictionary["auth"]` + `{ t: T }` makes `t` relative to `auth`
 */
export function collectUsedPaths(rawSource) {
  const source = stripNonCode(rawSource);
  const paths = new Set();
  const dynamic = new Set();
  const bases = new Map([
    ["t", ""],
    ["dict", ""],
    ["dictionary", ""],
  ]);

  for (const m of source.matchAll(/type (\w+) = Dictionary\["([\w.]+)"\]/g)) {
    if (new RegExp(String.raw`\bt:\s*${m[1]}\b`).test(source)) bases.set("t", m[2]);
  }

  const scan = () => {
    const names = aliasNames(bases);
    return new RegExp(String.raw`(?<![\w$.])(${names})\.(${DOTTED})(\[)?`, "g");
  };

  // aliases, repeated so an alias can build on an earlier alias
  for (let round = 0; round < 3; round += 1) {
    const names = aliasNames(bases);
    const simple = new RegExp(String.raw`const (${IDENT}) = (${names})\.(${DOTTED})\s*;`, "g");
    for (const m of source.matchAll(simple)) bases.set(m[1], join(bases.get(m[2]), m[3]));
    const destructured = new RegExp(
      String.raw`const \{([^}]*)\} = (${names})\.(${DOTTED})\s*;`,
      "g",
    );
    for (const m of source.matchAll(destructured)) {
      for (const part of m[1].split(",")) {
        const [from, to] = part.split(":").map((s) => s.trim());
        if (from) bases.set(to || from, join(bases.get(m[2]), `${m[3]}.${from}`));
      }
    }
  }

  for (const m of source.matchAll(scan())) {
    const full = join(bases.get(m[1]), m[2]);
    if (m[3]) dynamic.add(full);
    else paths.add(full);
  }
  return { paths: [...paths], dynamic: [...dynamic] };
}

/** Pure comparison step; the CLI feeds it the real dictionaries and scan results. */
export function findIssues({ arLeaves, enLeaves, usedPaths, dynamicRoots, dynamicUsed = [] }) {
  const issues = [];
  const ar = new Set(arLeaves);
  const en = new Set(enLeaves);
  const prefixes = new Set();
  for (const leaf of ar) {
    const parts = leaf.split(".");
    for (let i = 1; i < parts.length; i += 1) prefixes.add(parts.slice(0, i).join("."));
  }

  for (const leaf of ar) if (!en.has(leaf)) issues.push({ kind: "missing-in-en", path: leaf });
  for (const leaf of en) if (!ar.has(leaf)) issues.push({ kind: "missing-in-ar", path: leaf });

  const used = new Set();
  for (const root of dynamicRoots) {
    for (const leaf of ar) if (leaf === root || leaf.startsWith(`${root}.`)) used.add(leaf);
  }
  for (const root of dynamicUsed) {
    if (!dynamicRoots.includes(root)) issues.push({ kind: "dynamic-not-listed", path: root });
  }
  for (const p of usedPaths) {
    const parts = p.split(".");
    const leafPrefix = parts
      .map((_, i) => parts.slice(0, i + 1).join("."))
      .find((candidate) => ar.has(candidate));
    if (leafPrefix) used.add(leafPrefix);
    else if (!prefixes.has(p)) issues.push({ kind: "missing-in-ar", path: p });
  }
  for (const leaf of ar) if (!used.has(leaf)) issues.push({ kind: "unused", path: leaf });
  return issues;
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

async function main() {
  const root = process.cwd();
  const { tsImport } = await import("tsx/esm/api");
  const here = import.meta.url;
  const { ar } = await tsImport(pathToFileURL(path.join(root, "src/i18n/ar.ts")).href, here);
  const { en } = await tsImport(pathToFileURL(path.join(root, "src/i18n/en.ts")).href, here);
  const { DYNAMIC_KEY_ROOTS } = await tsImport(
    pathToFileURL(path.join(root, "src/i18n/dynamic-keys.ts")).href,
    here,
  );

  const skip = new Set([path.join("src", "i18n", "ar.ts"), path.join("src", "i18n", "en.ts")]);
  const usedPaths = new Set();
  const dynamicUsed = new Set();
  for (const file of walk(path.join(root, "src"))) {
    if (skip.has(path.relative(root, file))) continue;
    if (/\.test\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    if (!/import[^;]*\b(getDictionary|Dictionary)\b[^;]*from "@\/i18n\//.test(source)) continue;
    const result = collectUsedPaths(source);
    for (const p of result.paths) usedPaths.add(p);
    for (const p of result.dynamic) dynamicUsed.add(p);
  }

  const issues = findIssues({
    arLeaves: listLeaves(ar),
    enLeaves: listLeaves(en),
    usedPaths: [...usedPaths],
    dynamicRoots: [...DYNAMIC_KEY_ROOTS],
    dynamicUsed: [...dynamicUsed],
  });
  if (issues.length === 0) {
    console.log("i18n:check ok");
    return;
  }
  for (const issue of issues) {
    const where = issue.kind === "unused" ? " (delete from src/i18n/ar.ts and en.ts)" : "";
    console.error(`i18n:check ${issue.kind}: ${issue.path}${where}`);
  }
  console.error(`i18n:check failed: ${issues.length} issue(s)`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
