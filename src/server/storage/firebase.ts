import { assertStorageKey, type StorageAdapter, type StoredObject } from "./types";

/** The part of a Firebase / Cloud Storage bucket the driver uses; tests pass a fake. */
export type BucketLike = {
  file(name: string): {
    save(data: Uint8Array, options: { contentType: string; resumable: false }): Promise<unknown>;
    download(): Promise<[Uint8Array]>;
    getMetadata(): Promise<[{ contentType?: string }]>;
    delete(options: { ignoreNotFound: true }): Promise<unknown>;
    exists(): Promise<[boolean]>;
  };
};

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === 404;

/** A private Firebase Storage bucket (live). Objects get no public URL and no public ACL. */
export function firebaseStorage(bucket: BucketLike): StorageAdapter {
  const fileOf = (key: string) => bucket.file(assertStorageKey(key));
  return {
    driver: "firebase",
    async put(key, bytes, contentType) {
      await fileOf(key).save(bytes, { contentType, resumable: false });
    },
    async get(key): Promise<StoredObject | null> {
      const file = fileOf(key);
      try {
        const [[bytes], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
        return {
          bytes: new Uint8Array(bytes),
          contentType: meta.contentType ?? "application/octet-stream",
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      await fileOf(key).delete({ ignoreNotFound: true });
    },
    async exists(key) {
      const [found] = await fileOf(key).exists();
      return found;
    },
  };
}

/**
 * The live bucket from the service account JSON (`FIREBASE_SERVICE_ACCOUNT`) and the bucket name.
 * `firebase-admin` loads only here, and only when the firebase driver is selected.
 */
export async function firebaseBucket(
  serviceAccountJson: string,
  bucketName: string,
): Promise<BucketLike> {
  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const { getStorage } = await import("firebase-admin/storage");
  const name = "al-namer-storage";
  const app =
    getApps().find((candidate) => candidate.name === name) ??
    initializeApp(
      { credential: cert(JSON.parse(serviceAccountJson)), storageBucket: bucketName },
      name,
    );
  return getStorage(app).bucket(bucketName) as unknown as BucketLike;
}
