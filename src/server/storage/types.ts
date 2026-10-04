// Object storage behind one interface (F5b). Drivers: `local` (a directory, demo and tests) and
// `firebase` (a private Firebase Storage bucket, live). Objects are private: they are read through
// our own routes, never through public URLs.

export type StoredObject = { bytes: Uint8Array; contentType: string };

export interface StorageAdapter {
  readonly driver: "local" | "firebase";
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The object, or null when there is none. */
  get(key: string): Promise<StoredObject | null>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * What may be stored: lesson files, images and video. Never HTML, SVG or scripts, which would run
 * same-origin if a route ever served a stored object with its stored type.
 */
export const STORAGE_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;

export function assertStorageContentType(contentType: string): string {
  if (!(STORAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new Error("content type not allowed in storage");
  }
  return contentType;
}

const KEY = /^[a-z0-9][a-z0-9/_.-]*$/;
const MAX_KEY = 512;

/**
 * Keys are made by the server (`courses/<id>/files/<uuid>.pdf`), never by a user: lower-case
 * letters, digits, `/ _ . -`, no `..`, no empty segment, at most 512 characters. Anything else
 * throws, so a bad key is a bug, never a path.
 */
export function assertStorageKey(key: string): string {
  if (
    key.length > MAX_KEY ||
    !KEY.test(key) ||
    key.includes("..") ||
    key.includes("//") ||
    key.endsWith("/")
  ) {
    throw new Error("invalid storage key");
  }
  return key;
}
