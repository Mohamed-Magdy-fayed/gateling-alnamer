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
const ALLOWED_DIRS = [path.join("server", "catalog"), path.join("server", "db")];
const TEST_FILE = /\.(int\.)?test\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Names imported from the schema module, e.g. `import { a, b as c } from "@/server/db/schema"`. */
function schemaImports(source: string): string[] {
  const names: string[] = [];
  const pattern = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema["']/g;
  for (const match of source.matchAll(pattern)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name) names.push(name);
    }
  }
  return names;
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

  it("keeps content tables inside src/server/catalog", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file);
      if (TEST_FILE.test(relative)) continue;
      if (ALLOWED_DIRS.some((dir) => relative.startsWith(dir + path.sep))) continue;
      const used = schemaImports(readFileSync(file, "utf8")).filter((name) =>
        CONTENT_TABLES.includes(name),
      );
      if (used.length > 0) {
        offenders.push(
          `src/${relative.split(path.sep).join("/")} imports ${used.join(", ")}; read content through src/server/catalog/repository.ts`,
        );
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
