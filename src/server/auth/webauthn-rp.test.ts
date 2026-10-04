import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ serverEnv: () => ({}) }));
const { relyingPartyFor } = await import("./webauthn-rp");

describe("relyingPartyFor", () => {
  it("accepts the configured site origin only, when deployed", () => {
    const env = { BASE_URL: "https://alnamer.gateling.com", VERCEL: "1" };
    expect(relyingPartyFor("https://alnamer.gateling.com", env)).toEqual({
      rpID: "alnamer.gateling.com",
      origin: "https://alnamer.gateling.com",
    });
    expect(relyingPartyFor("https://evil.example", env)).toBeNull();
    expect(relyingPartyFor("http://localhost:3410", env)).toBeNull();
    expect(relyingPartyFor(null, env)).toBeNull();
  });

  it("accepts any localhost port off Vercel", () => {
    const env = { BASE_URL: "http://localhost:3400" };
    expect(relyingPartyFor("http://localhost:3410", env)).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3410",
    });
    expect(relyingPartyFor("not a url", env)).toBeNull();
  });
});

describe("relyingPartyFor off Vercel in live mode", () => {
  it("does not accept localhost origins on a live deployment", () => {
    expect(
      relyingPartyFor("http://localhost:3000", {
        BASE_URL: "https://alnamer.example",
        APP_MODE: "live",
      }),
    ).toBeNull();
    expect(
      relyingPartyFor("https://alnamer.example", { BASE_URL: "https://alnamer.example" }),
    ).toEqual({
      rpID: "alnamer.example",
      origin: "https://alnamer.example",
    });
  });
});
