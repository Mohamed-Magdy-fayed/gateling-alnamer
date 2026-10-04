import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertStorageKey, type StorageAdapter, type StoredObject } from "./types";

/** The content type lives next to the object (`<file>.meta.json`). */
const metaPath = (file: string) => `${file}.meta.json`;

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";

/**
 * Files under one root directory (demo and tests). Every resolved path is checked to stay inside
 * the root, on top of the key rule.
 */
export function localStorage(rootDir: string): StorageAdapter {
  const root = path.resolve(rootDir);
  const fileOf = (key: string): string => {
    const file = path.resolve(root, assertStorageKey(key));
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("invalid storage key");
    return file;
  };

  return {
    driver: "local",
    async put(key, bytes, contentType) {
      const file = fileOf(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
      await writeFile(metaPath(file), JSON.stringify({ contentType }));
    },
    async get(key): Promise<StoredObject | null> {
      const file = fileOf(key);
      try {
        const [bytes, meta] = await Promise.all([readFile(file), readFile(metaPath(file), "utf8")]);
        const { contentType } = JSON.parse(meta) as { contentType?: unknown };
        return {
          bytes: new Uint8Array(bytes),
          contentType: typeof contentType === "string" ? contentType : "application/octet-stream",
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      const file = fileOf(key);
      await Promise.all([rm(file, { force: true }), rm(metaPath(file), { force: true })]);
    },
    async exists(key) {
      try {
        return (await stat(fileOf(key))).isFile();
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },
  };
}
