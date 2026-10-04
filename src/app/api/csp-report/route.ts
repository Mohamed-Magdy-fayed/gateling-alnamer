import { guardCspReport } from "@/server/auth/abuse";
import { clientIp } from "@/server/request-ip";
import { summarizeCspReport } from "@/server/security/csp-report";

const MAX_BODY_BYTES = 8 * 1024;
const NO_CONTENT = () => new Response(null, { status: 204 });

/**
 * The body as text, or null once it passes `max` bytes: reads the stream in chunks and stops
 * there, so a chunked upload (no content-length) is never buffered whole.
 */
async function readLimited(request: Request, max: number): Promise<string | null> {
  if (Number(request.headers.get("content-length") ?? 0) > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * CSP violation reports from browsers (F5b, report-only phase). Public by design and rate limited
 * per IP. Logs one compact line per violation (see `summarizeCspReport`); always answers 204.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await guardCspReport({ ip: clientIp(request.headers) });
  if (!("ok" in guard)) return NO_CONTENT();
  const text = await readLimited(request, MAX_BODY_BYTES);
  if (!text) return NO_CONTENT();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NO_CONTENT();
  }
  for (const v of summarizeCspReport(body)) {
    console.warn(`[csp] ${v.directive} blocked=${v.blocked} page=${v.page}`);
  }
  return NO_CONTENT();
}
