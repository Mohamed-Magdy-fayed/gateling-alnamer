import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BucketLike, firebaseStorage } from "./firebase";
import { localStorage } from "./local";
import { assertStorageKey } from "./types";

describe("assertStorageKey", () => {
  it("accepts server-made keys and refuses anything that could be a path trick", () => {
    expect(assertStorageKey("courses/c1/files/a-b_c.pdf")).toBe("courses/c1/files/a-b_c.pdf");
    for (const bad of [
      "",
      "/etc/passwd",
      "../x",
      "a/../b",
      "a//b",
      "a/",
      "A.pdf",
      "a\\b",
      "a b",
      `a${"x".repeat(512)}`,
    ]) {
      expect(() => assertStorageKey(bad), bad).toThrow("invalid storage key");
    }
  });
});

describe("local storage", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "alnamer-storage-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("puts, gets with its content type, checks and deletes", async () => {
    const store = localStorage(root);
    const bytes = new Uint8Array([37, 80, 68, 70]);
    expect(await store.exists("courses/c1/a.pdf")).toBe(false);
    expect(await store.get("courses/c1/a.pdf")).toBeNull();
    await store.put("courses/c1/a.pdf", bytes, "application/pdf");
    expect(await store.exists("courses/c1/a.pdf")).toBe(true);
    expect(await store.get("courses/c1/a.pdf")).toEqual({ bytes, contentType: "application/pdf" });
    await store.delete("courses/c1/a.pdf");
    await store.delete("courses/c1/a.pdf");
    expect(await store.exists("courses/c1/a.pdf")).toBe(false);
    expect(await readdir(path.join(root, "courses/c1"))).toEqual([]);
  });

  it("never touches a path outside its root", async () => {
    const store = localStorage(root);
    await expect(store.put("../escape.txt", new Uint8Array([1]), "text/plain")).rejects.toThrow(
      "invalid storage key",
    );
    await expect(store.get("a/../../x")).rejects.toThrow("invalid storage key");
  });
});

describe("firebase storage", () => {
  /** A fake bucket with the same calls as Cloud Storage. */
  function fakeBucket() {
    const objects = new Map<string, { data: Uint8Array; contentType: string }>();
    const notFound = () => Object.assign(new Error("No such object"), { code: 404 });
    const bucket: BucketLike = {
      file: (name) => ({
        save: async (data, options) => {
          objects.set(name, { data, contentType: options.contentType });
        },
        download: async () => {
          const found = objects.get(name);
          if (!found) throw notFound();
          return [found.data];
        },
        getMetadata: async () => {
          const found = objects.get(name);
          if (!found) throw notFound();
          return [{ contentType: found.contentType }];
        },
        delete: async () => {
          objects.delete(name);
        },
        exists: async () => [objects.has(name)],
      }),
    };
    return { bucket, objects };
  }

  it("stores private objects by key and maps not-found to null", async () => {
    const { bucket, objects } = fakeBucket();
    const store = firebaseStorage(bucket);
    expect(store.driver).toBe("firebase");
    expect(await store.get("x/a.png")).toBeNull();
    await store.put("x/a.png", new Uint8Array([1, 2]), "image/png");
    expect(objects.get("x/a.png")?.contentType).toBe("image/png");
    expect(await store.get("x/a.png")).toEqual({
      bytes: new Uint8Array([1, 2]),
      contentType: "image/png",
    });
    expect(await store.exists("x/a.png")).toBe(true);
    await store.delete("x/a.png");
    expect(await store.exists("x/a.png")).toBe(false);
  });

  it("refuses bad keys before calling the bucket and rethrows other errors", async () => {
    const failing: BucketLike = {
      file: () => ({
        save: async () => undefined,
        download: async () => {
          throw Object.assign(new Error("denied"), { code: 403 });
        },
        getMetadata: async () => [{}],
        delete: async () => undefined,
        exists: async () => [true],
      }),
    };
    const store = firebaseStorage(failing);
    await expect(store.get("../x")).rejects.toThrow("invalid storage key");
    await expect(store.get("ok.png")).rejects.toThrow("denied");
  });
});
