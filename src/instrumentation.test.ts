import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: { SENTRY_DSN: undefined as string | undefined, VERCEL_ENV: "preview" },
  init: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/server/env-schema", () => ({
  parseServerEnv: () => h.env,
  describeProviders: () => "providers",
}));
vi.mock("@sentry/nextjs", () => ({ init: h.init, captureRequestError: h.capture }));

const { register, onRequestError } = await import("./instrumentation");
vi.spyOn(console, "info").mockImplementation(() => undefined);

afterEach(() => {
  h.env.SENTRY_DSN = undefined;
  delete process.env.SENTRY_DSN;
  vi.clearAllMocks();
});

describe("instrumentation", () => {
  it("never starts Sentry or reports without a DSN", async () => {
    await register();
    await onRequestError(new Error("x"), {} as never, {} as never);
    expect(h.init).not.toHaveBeenCalled();
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("starts Sentry with the scrubbing options when SENTRY_DSN is set", async () => {
    h.env.SENTRY_DSN = "https://k@o1.ingest.sentry.io/1";
    process.env.SENTRY_DSN = h.env.SENTRY_DSN;
    await register();
    expect(h.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: h.env.SENTRY_DSN,
        environment: "preview",
        sendDefaultPii: false,
      }),
    );
    const error = new Error("boom");
    await onRequestError(error, {} as never, {} as never);
    expect(h.capture).toHaveBeenCalledWith(error, {}, {});
  });
});
