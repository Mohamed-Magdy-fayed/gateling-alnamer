import { guardCspReport } from "@/server/auth/abuse";
import { clientIp } from "@/server/request-ip";
import { summarizeCspReport } from "@/server/security/csp-report";

const MAX_BODY_BYTES = 8 * 1024;
const NO_CONTENT = () => new Response(null, { status: 204 });

/**
 * CSP violation reports from browsers (F5b, report-only phase). Public by design and rate limited
 * per IP. Logs one compact line per violation (see `summarizeCspReport`); always answers 204.
 */
export async function POST(request: Request): Promise<Response> {
  const guard = await guardCspReport({ ip: clientIp(request.headers) });
  if (!("ok" in guard)) return NO_CONTENT();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return NO_CONTENT();
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BODY_BYTES) return NO_CONTENT();
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
