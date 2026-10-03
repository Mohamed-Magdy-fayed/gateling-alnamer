import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../..");
const CONTENT_TABLES = [
  "courses",
  "courseRevisions",
  "sections",
  "sectionRevisions",
  "lessons",
  "lessonRevisions",
  "categories",
  "courseCategories",
  "teacherProfiles",
  "mediaAssets",
];
const ALLOWED_DIRS = [
  path.join("server", "catalog"),
  path.join("server", "db"),
  path.join("server", "orders"),
  path.join("server", "access"),
  path.join("server", "payments"),
];
const TEST_FILE = /\.(int\.)?test\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const SCHEMA_MODULE = String.raw`["'][^"']*db\/schema["']`;

function listedNames(list: string): string[] {
  return list
    .split(",")
    .map((part) =>
      part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim(),
    )
    .filter((name): name is string => Boolean(name));
}

/** Names imported from the schema module, e.g. `import { a, b as c } from "@/server/db/schema"`. */
function schemaImports(source: string): string[] {
  const pattern = new RegExp(
    String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*${SCHEMA_MODULE}`,
    "g",
  );
  return [...source.matchAll(pattern)].flatMap((match) => listedNames(match[1] ?? ""));
}

/** Every way a file can reach content tables other than a plain named import. */
function contentViolations(source: string): string[] {
  const found: string[] = [];
  for (const name of schemaImports(source)) {
    if (CONTENT_TABLES.includes(name)) found.push(`imports ${name}`);
  }
  const namespace = new RegExp(
    String.raw`import\s+(?:type\s+)?\*\s+as\s+\w+\s+from\s*${SCHEMA_MODULE}`,
  );
  if (namespace.test(source)) found.push("imports the schema namespace");
  const dynamic = new RegExp(String.raw`import\(\s*${SCHEMA_MODULE}\s*\)`);
  if (dynamic.test(source)) found.push("dynamically imports the schema");
  const reExportAll = new RegExp(
    String.raw`export\s+(?:type\s+)?\*(?:\s+as\s+\w+)?\s+from\s*${SCHEMA_MODULE}`,
  );
  if (reExportAll.test(source)) found.push("re-exports the whole schema");
  const reExport = new RegExp(
    String.raw`export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*${SCHEMA_MODULE}`,
    "g",
  );
  for (const match of source.matchAll(reExport)) {
    for (const name of listedNames(match[1] ?? "")) {
      if (CONTENT_TABLES.includes(name)) found.push(`re-exports ${name}`);
    }
  }
  for (const match of source.matchAll(/\.query\.(\w+)/g)) {
    const name = match[1] ?? "";
    if (CONTENT_TABLES.includes(name)) found.push(`uses .query.${name}`);
  }
  return found;
}

describe("content table access", () => {
  it("detects content table imports", () => {
    expect(schemaImports(`import { courses, users } from "@/server/db/schema";`)).toEqual([
      "courses",
      "users",
    ]);
    expect(
      schemaImports(`import {\n  lessons as l,\n  type User,\n} from "../db/schema";`),
    ).toEqual(["lessons", "User"]);
    expect(schemaImports(`import { x } from "@/server/db";`)).toEqual([]);
  });

  it("flags named, namespace, dynamic, re-export and relational query access", () => {
    expect(contentViolations(`import { courses } from "@/server/db/schema";`)).toEqual([
      "imports courses",
    ]);
    expect(contentViolations(`import * as schema from "@/server/db/schema";`)).toEqual([
      "imports the schema namespace",
    ]);
    expect(contentViolations(`const s = await import("@/server/db/schema");`)).toEqual([
      "dynamically imports the schema",
    ]);
    expect(contentViolations(`export { courses } from "../db/schema";`)).toEqual([
      "re-exports courses",
    ]);
    expect(contentViolations(`export * from "../db/schema";`)).toEqual([
      "re-exports the whole schema",
    ]);
    expect(contentViolations(`const rows = await db().query.courses.findMany();`)).toEqual([
      "uses .query.courses",
    ]);
    expect(contentViolations(`tx.query.lessons.findFirst({})`)).toEqual(["uses .query.lessons"]);
  });

  it("allows non-content schema use", () => {
    expect(contentViolations(`import { users } from "@/server/db/schema";`)).toEqual([]);
    expect(contentViolations(`db().query.users.findFirst({})`)).toEqual([]);
  });

  it("keeps content tables inside src/server/catalog", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file);
      if (TEST_FILE.test(relative)) continue;
      if (ALLOWED_DIRS.some((dir) => relative.startsWith(dir + path.sep))) continue;
      const used = contentViolations(readFileSync(file, "utf8"));
      if (used.length > 0) {
        offenders.push(
          `src/${relative.split(path.sep).join("/")} ${used.join(", ")}; read content through src/server/catalog/repository.ts`,
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
