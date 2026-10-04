import { describe, expect, it } from "vitest";
import { scrubEvent, sentryOptions, withoutQuery } from "./sentry-options";

describe("scrubEvent", () => {
  it("keeps the path but drops queries, cookies, headers, bodies and the user", () => {
    const event = scrubEvent({
      request: {
        url: "https://alnamer.example/reset-password/continue?t=secret#x",
        query_string: "t=secret",
        cookies: { "__Host-session": "token" },
        headers: { cookie: "x", authorization: "y" },
        data: { password: "p" },
      },
      user: { email: "a@b.c", ip_address: "1.2.3.4" },
      breadcrumbs: [
        { data: { url: "/api/oauth/google?code=abc&state=s", method: "GET" } },
        { data: { from: "/sign-in?next=/x", to: "/dashboard?tab=1" } },
        {},
      ],
    });
    expect(event.request).toEqual({ url: "https://alnamer.example/reset-password/continue" });
    expect(event.user).toBeUndefined();
    expect(event.breadcrumbs?.[0]?.data).toEqual({ url: "/api/oauth/google", method: "GET" });
    expect(event.breadcrumbs?.[1]?.data).toEqual({ from: "/sign-in", to: "/dashboard" });
    expect(JSON.stringify(event)).not.toMatch(/t=secret|"token"|code=abc|"password"|1\.2\.3\.4/);
  });

  it("leaves an event without a request alone", () => {
    expect(scrubEvent({})).toEqual({});
    expect(withoutQuery("/plain")).toBe("/plain");
  });
});

describe("sentryOptions", () => {
  it("sends errors only, no default PII, and drops console breadcrumbs", () => {
    const options = sentryOptions("https://k@o1.ingest.sentry.io/1", "preview");
    expect(options).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "preview",
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options.beforeBreadcrumb({ category: "console" })).toBeNull();
    expect(options.beforeBreadcrumb({ category: "navigation" })).toEqual({
      category: "navigation",
    });
    expect(sentryOptions("https://k@o1.ingest.sentry.io/1", undefined).environment).toBe(
      "development",
    );
  });
});
