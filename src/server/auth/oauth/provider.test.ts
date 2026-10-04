import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { oauthProvider } = await import("./provider");

describe("oauthProvider", () => {
  it("uses Google with both keys, and the mock only by explicit local opt-in", () => {
    expect(
      oauthProvider({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", APP_MODE: "demo" })?.id,
    ).toBe("google");
    expect(oauthProvider({ APP_MODE: "demo" })).toBeNull();
    expect(oauthProvider({ APP_MODE: "demo", OAUTH_FORCE_MOCK: "1" })?.id).toBe("mock");
    expect(oauthProvider({ APP_MODE: "demo", OAUTH_FORCE_MOCK: "1", VERCEL: "1" })).toBeNull();
    expect(oauthProvider({ APP_MODE: "live", OAUTH_FORCE_MOCK: "1" })).toBeNull();
  });
});
