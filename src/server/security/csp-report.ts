// What a CSP violation report may put in the logs (F5b): the directive, the blocked origin or
// keyword, and the page path. Never a query string (reset links carry tokens), a full URL or the
// raw body.

export type CspViolation = { directive: string; blocked: string; page: string };

const MAX_FIELD = 120;

const clip = (value: string): string => value.slice(0, MAX_FIELD).replace(/[\r\n]/g, " ");

/** An origin for a URL, a keyword (`inline`, `eval`, `data`) as is, else "other". */
function blockedOf(value: unknown): string {
  if (typeof value !== "string" || value === "") return "none";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : url.protocol;
  } catch {
    return /^[a-z-]+$/i.test(value) ? value : "other";
  }
}

function pageOf(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  try {
    return new URL(value).pathname;
  } catch {
    return "unknown";
  }
}

function violationOf(report: Record<string, unknown>): CspViolation | null {
  const directive =
    report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"];
  if (typeof directive !== "string") return null;
  return {
    directive: clip(directive),
    blocked: clip(blockedOf(report["blocked-uri"] ?? report.blockedURL)),
    page: clip(pageOf(report["document-uri"] ?? report.documentURL)),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The violations in a report body: the legacy `{ "csp-report": {...} }` shape or the Reporting API
 * array of `{ type: "csp-violation", body: {...} }`. At most 10; anything else is ignored.
 */
export function summarizeCspReport(body: unknown): CspViolation[] {
  if (isRecord(body) && isRecord(body["csp-report"])) {
    const one = violationOf(body["csp-report"]);
    return one ? [one] : [];
  }
  if (!Array.isArray(body)) return [];
  return body
    .slice(0, 10)
    .filter(
      (item): item is Record<string, unknown> => isRecord(item) && item.type === "csp-violation",
    )
    .map((item) => (isRecord(item.body) ? violationOf(item.body) : null))
    .filter((item): item is CspViolation => item !== null);
}
