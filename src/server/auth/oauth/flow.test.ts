import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { codeChallenge, newFlow, openFlow, sealFlow, statesMatch } from "./flow";

const KEY = Buffer.alloc(32, 6);
const NOW_S = 1_900_000_000;

describe("PKCE and state", () => {
  it("derives the S256 challenge from the verifier", () => {
    const verifier = "dBjftJeZ4CVP-mJ92K9-T7cpgV2qjrJjVYgf4SoFJs4";
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(codeChallenge(verifier)).toBe(expected);
  });

  it("makes long random state and verifier values", () => {
    const flow = newFlow("/dashboard", NOW_S);
    expect(flow.state).toMatch(/^[\w-]{43}$/);
    expect(flow.verifier).toMatch(/^[\w-]{43,128}$/);
    expect(flow.state).not.toBe(newFlow("/dashboard", NOW_S).state);
  });

  it("compares states in constant time and refuses mismatches", () => {
    expect(statesMatch("abc", "abc")).toBe(true);
    expect(statesMatch("abc", "abd")).toBe(false);
    expect(statesMatch("abc", "abcd")).toBe(false);
    expect(statesMatch("", "")).toBe(false);
  });
});

describe("sealed flow cookie", () => {
  it("round-trips within 10 minutes and expires after", () => {
    const flow = newFlow("/courses", NOW_S);
    const sealed = sealFlow(KEY, flow);
    expect(openFlow(KEY, sealed, NOW_S + 60)).toEqual(flow);
    expect(openFlow(KEY, sealed, NOW_S + 601)).toBeNull();
    expect(openFlow(Buffer.alloc(32, 1), sealed, NOW_S)).toBeNull();
    expect(openFlow(KEY, "garbage", NOW_S)).toBeNull();
  });
});
