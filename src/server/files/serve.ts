import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type AccessUser, getLessonAccess } from "@/server/access/lesson-access";
import { loadLessonFile } from "@/server/access/lesson-media";
import { watermarkNumber } from "@/server/auth/profile";
import { stampPdf, stampText } from "./stamp";

/** Bundled sample files; shipped with the files route via `outputFileTracingIncludes`. */
export const SAMPLE_FILES_DIR = path.join(process.cwd(), "media", "sample");

export type FileResponse = {
  status: 200 | 401 | 403 | 404;
  headers: Record<string, string>;
  body: Uint8Array | null;
};

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

const bare = (status: 401 | 403 | 404): FileResponse => ({
  status,
  headers: PRIVATE_HEADERS,
  body: null,
});

/**
 * A lesson's PDF for the signed-in viewer: the access decision with the session's device, then the
 * file stamped with the viewer's public number and today's date (teachers and staff previewing
 * get their own). Every denial is a bare 403; no file is a 404.
 */
export async function serveLessonFile(
  viewer: AccessUser | null,
  lessonId: string,
  now: Date,
): Promise<FileResponse> {
  if (!viewer) return bare(401);
  const access = await getLessonAccess(viewer, lessonId, now);
  if (!access.allowed) return access.reason === "not_found" ? bare(404) : bare(403);
  const fileName = await loadLessonFile(access.grant);
  if (!fileName) return bare(404);
  const source = await readFile(path.join(SAMPLE_FILES_DIR, fileName)).catch(() => null);
  if (!source) return bare(404);
  const stamped = await stampPdf(source, stampText(await watermarkNumber(viewer.id), now));
  return {
    status: 200,
    headers: {
      ...PRIVATE_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="lesson.pdf"',
      // Shown in an iframe on the learn page (same origin only).
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
      "Content-Length": String(stamped.byteLength),
    },
    body: stamped,
  };
}
