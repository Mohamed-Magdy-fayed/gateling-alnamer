// Sentry settings shared by the server and the browser (F5b). Sentry runs only when a DSN is set;
// events leave without cookies, headers, query strings, user details, extra data or email
// addresses, and breadcrumbs keep only an allowlist of fields.

type Crumb = { message?: string; data?: Record<string, unknown> };

/** The parts of a Sentry event the scrubber touches (structurally typed, no SDK import). */
type ScrubbableEvent = {
  message?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
  };
  user?: unknown;
  extra?: unknown;
  contexts?: Record<string, unknown>;
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Crumb[];
};

/** A URL without its query and fragment (reset links and OAuth callbacks carry secrets there). */
export function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

const EMAIL = /[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+/g;
const URL_QUERY = /(https?:\/\/[^\s?#"']*|\/[^\s?#"']*)[?#][^\s"']*/g;

/** Free text (messages, exception values): no email addresses, no URL queries or fragments. */
export function redactText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(URL_QUERY, "$1");
}

/** Breadcrumb data that may leave: the rest (query and fragment keys, bodies) is dropped. */
const CRUMB_KEYS = ["url", "method", "status_code", "from", "to"] as const;
const CRUMB_URL_KEYS = new Set(["url", "from", "to"]);

function scrubCrumb(crumb: Crumb): void {
  if (crumb.message) crumb.message = redactText(crumb.message);
  if (!crumb.data) return;
  const kept: Record<string, unknown> = {};
  for (const key of CRUMB_KEYS) {
    const value = crumb.data[key];
    if (value === undefined) continue;
    kept[key] = CRUMB_URL_KEYS.has(key) && typeof value === "string" ? withoutQuery(value) : value;
  }
  crumb.data = kept;
}

/** Removes everything personal or secret from an event before it is sent. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    const { url } = event.request;
    event.request = url ? { url: withoutQuery(url) } : {};
  }
  delete event.user;
  delete event.extra;
  if (event.contexts) delete event.contexts.response;
  if (event.message) event.message = redactText(event.message);
  for (const value of event.exception?.values ?? []) {
    if (value.value) value.value = redactText(value.value);
  }
  for (const crumb of event.breadcrumbs ?? []) scrubCrumb(crumb);
  return event;
}

/**
 * `Sentry.init` options: errors only, no default PII, scrubbed events. `tracesSampleRate` is left
 * out on purpose: even 0 turns tracing on (trace headers on outgoing requests).
 */
export function sentryOptions(dsn: string, environment: string | undefined) {
  return {
    dsn,
    environment: environment ?? "development",
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    beforeBreadcrumb: <B extends { category?: string }>(crumb: B): B | null =>
      // Console breadcrumbs can quote anything the app logged; drop them.
      crumb.category === "console" ? null : crumb,
  };
}
