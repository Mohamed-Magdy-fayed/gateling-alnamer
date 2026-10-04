// Sentry settings shared by the server and the browser (F5b). Sentry runs only when a DSN is set;
// events leave without cookies, headers, query strings or user details.

/** The parts of a Sentry event the scrubber touches (structurally typed, no SDK import). */
type ScrubbableEvent = {
  request?: {
    url?: string;
    query_string?: unknown;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
  };
  user?: unknown;
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>;
};

/** A URL without its query and fragment (reset links and OAuth callbacks carry secrets there). */
export function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Removes everything personal or secret from an event before it is sent. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.request) {
    const { url } = event.request;
    event.request = url ? { url: withoutQuery(url) } : {};
  }
  delete event.user;
  for (const crumb of event.breadcrumbs ?? []) {
    if (!crumb.data) continue;
    for (const key of ["url", "from", "to"]) {
      const value = crumb.data[key];
      if (typeof value === "string") crumb.data[key] = withoutQuery(value);
    }
  }
  return event;
}

/** `Sentry.init` options: errors only (no tracing, no replay), no default PII, scrubbed events. */
export function sentryOptions(dsn: string, environment: string | undefined) {
  return {
    dsn,
    environment: environment ?? "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: <B extends { category?: string }>(crumb: B): B | null =>
      // Console breadcrumbs can quote anything the app logged; drop them.
      crumb.category === "console" ? null : crumb,
  };
}
