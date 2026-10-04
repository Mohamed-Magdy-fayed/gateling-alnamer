import "server-only";
import path from "node:path";
import { serverEnv } from "@/server/env";
import { firebaseBucket, firebaseStorage } from "./firebase";
import { localStorage } from "./local";
import type { StorageAdapter } from "./types";

export { assertStorageKey, type StorageAdapter, type StoredObject } from "./types";

const DEFAULT_LOCAL_DIR = ".storage";

let cached: Promise<StorageAdapter> | null = null;

/**
 * The storage for this deployment: `STORAGE_DRIVER` (demo default `local`; live must be
 * `firebase`, which the env schema enforces together with its credentials).
 */
export function storage(): Promise<StorageAdapter> {
  // A failed start (import or credentials) is not cached: the next call tries again.
  cached ??= (async () => {
    const env = serverEnv();
    if (env.providers.storage === "firebase") {
      const {
        FIREBASE_PROJECT_ID: projectId,
        FIREBASE_CLIENT_EMAIL: clientEmail,
        FIREBASE_PRIVATE_KEY: privateKey,
        FIREBASE_STORAGE_BUCKET: bucket,
      } = env;
      if (!projectId || !clientEmail || !privateKey || !bucket) {
        throw new Error("STORAGE_DRIVER=firebase without its credentials");
      }
      return firebaseStorage(await firebaseBucket({ projectId, clientEmail, privateKey }, bucket));
    }
    return localStorage(path.resolve(env.STORAGE_LOCAL_DIR ?? DEFAULT_LOCAL_DIR));
  })().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}
