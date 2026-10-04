import { describe, expect, it } from "vitest";
import { redactText, scrubEvent, sentryOptions, withoutQuery } from "./sentry-options";

describe("scrubEvent", () => {
  it("keeps the path but drops queries, cookies, headers, bodies, extra data and the user", () => {
    const event = scrubEvent({
      request: {
        url: "https://alnamer.example/reset-password/continue?t=secret#x",
        query_string: "t=secret",
        cookies: { "__Host-session": "token" },
        headers: { cookie: "x", authorization: "y" },
        data: { password: "p" },
      },
      user: { email: "a@b.c", ip_address: "1.2.3.4" },
      extra: { body: "t=secret" },
      contexts: { response: { headers: { "set-cookie": "token" } }, os: { name: "linux" } },
    });
    expect(event.request).toEqual({ url: "https://alnamer.example/reset-password/continue" });
    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.contexts).toEqual({ os: { name: "linux" } });
    expect(JSON.stringify(event)).not.toMatch(/t=secret|"token"|"password"|1\.2\.3\.4/);
  });

  it("keeps only allowlisted breadcrumb fields: no query or fragment keys, no bodies", () => {
    const event = scrubEvent({
      breadcrumbs: [
        {
          data: {
            url: "https://api.example/pay?code=abc",
            method: "POST",
            status_code: 500,
            "http.query": "?signature=s3cret",
            "http.fragment": "#token",
            body: "card=4111",
          },
        },
        { data: { from: "/sign-in?next=/x", to: "/dashboard?tab=1" } },
        { message: "GET https://api.example/x?key=s3cret failed for a@b.co" },
        {},
      ],
    });
    expect(event.breadcrumbs?.[0]?.data).toEqual({
      url: "https://api.example/pay",
      method: "POST",
      status_code: 500,
    });
    expect(event.breadcrumbs?.[1]?.data).toEqual({ from: "/sign-in", to: "/dashboard" });
    expect(event.breadcrumbs?.[2]?.message).toBe("GET https://api.example/x failed for [email]");
    expect(JSON.stringify(event)).not.toMatch(/s3cret|abc|4111|#token|a@b\.co/);
  });

  it("redacts emails and URL queries in messages and exception values", () => {
    const event = scrubEvent({
      message: "reset for who@example.test at /reset-password/continue?t=abc",
      exception: {
        values: [{ value: "duplicate key: Key (email)=(sam@example.test) already exists." }, {}],
      },
    });
    expect(event.message).toBe("reset for [email] at /reset-password/continue");
    expect(event.exception?.values?.[0]?.value).toBe(
      "duplicate key: Key (email)=([email]) already exists.",
    );
    expect(redactText("no secrets here")).toBe("no secrets here");
  });

  it("masks the teacher invite token in URLs, breadcrumbs and free text", () => {
    const token = "Zm9vYmFyYmF6cXV4_-0123456789abcdefghijklmn";
    const event = scrubEvent({
      request: { url: `https://alnamer.example/teach/invite/${token}?x=1` },
      message: `failed at https://alnamer.example/teach/invite/${token}`,
      breadcrumbs: [{ data: { from: `/teach/invite/${token}`, to: "/dashboard" } }],
    });
    expect(event.request?.url).toBe("https://alnamer.example/teach/invite/[token]");
    expect(event.message).toBe("failed at https://alnamer.example/teach/invite/[token]");
    expect(event.breadcrumbs?.[0]?.data).toEqual({
      from: "/teach/invite/[token]",
      to: "/dashboard",
    });
    expect(JSON.stringify(event)).not.toContain(token);
  });

  it("leaves an empty event alone", () => {
    expect(scrubEvent({})).toEqual({});
    expect(withoutQuery("/plain")).toBe("/plain");
  });
});

describe("sentryOptions", () => {
  it("sends errors only (no tracing option at all), no default PII, no console breadcrumbs", () => {
    const options = sentryOptions("https://k@o1.ingest.sentry.io/1", "preview");
    expect(options).toMatchObject({
      dsn: "https://k@o1.ingest.sentry.io/1",
      environment: "preview",
      sendDefaultPii: false,
    });
    expect("tracesSampleRate" in options).toBe(false);
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
