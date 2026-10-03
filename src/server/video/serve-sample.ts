import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { sampleFileName } from "@/server/access/lesson-media";
import { authKey } from "@/server/auth/keys";
import { verifyPlayback } from "./sign";

/** Bundled sample media; shipped with the media route via `outputFileTracingIncludes`. */
export const SAMPLE_MEDIA_DIR = path.join(process.cwd(), "media", "sample");

export type MediaViewer = { userId: string; deviceId: string | null } | null;

/** The signature and expiry check alone, so the route can refuse junk before reading the session. */
export function isSignedForAsset(
  assetId: string,
  params: Readonly<Record<string, string | undefined>>,
  nowS: number,
  key: Buffer = authKey("media"),
): boolean {
  return verifyPlayback(key, assetId, params, nowS) !== null;
}

export type MediaResponse = {
  status: 200 | 206 | 403 | 416;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
};

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

const deny = (): MediaResponse => ({ status: 403, headers: PRIVATE_HEADERS, body: null });

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes; null when unsatisfiable. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || end < start) return null;
  return { start, end };
}

/**
 * Serves a sample video for a signed playback URL. The URL must verify (signature, expiry), and a
 * URL issued to a user only plays in that user's session on the same device. Every refusal is a
 * bare 403. Supports byte ranges so the player can seek.
 */
export async function serveSample(
  input: {
    assetId: string;
    params: Readonly<Record<string, string | undefined>>;
    range: string | null;
    viewer: MediaViewer;
    nowS: number;
  },
  key: Buffer = authKey("media"),
): Promise<MediaResponse> {
  const claims = verifyPlayback(key, input.assetId, input.params, input.nowS);
  if (!claims) return deny();
  if (claims.userId !== null) {
    if (!input.viewer || input.viewer.userId !== claims.userId) return deny();
    if (input.viewer.deviceId !== claims.deviceId) return deny();
  }
  const fileName = await sampleFileName(claims.assetId);
  if (!fileName) return deny();
  const filePath = path.join(SAMPLE_MEDIA_DIR, fileName);
  const size = await stat(filePath).then(
    (info) => (info.isFile() ? info.size : null),
    () => null,
  );
  if (size === null) return deny();

  const base = {
    ...PRIVATE_HEADERS,
    "Content-Type": "video/webm",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
  };
  if (input.range) {
    const range = parseRange(input.range, size);
    if (!range) {
      return { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` }, body: null };
    }
    const stream = createReadStream(filePath, { start: range.start, end: range.end });
    return {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Content-Length": String(range.end - range.start + 1),
      },
      body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    };
  }
  return {
    status: 200,
    headers: { ...base, "Content-Length": String(size) },
    body: Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>,
  };
}
