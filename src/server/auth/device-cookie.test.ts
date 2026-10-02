import { describe, expect, it } from "vitest";
import { FakeCookieStore } from "../../../test/fake-cookies";
import { DEVICE_COOKIE, issueDeviceCookie, parseDeviceCookie, signDeviceId } from "./device-cookie";

const SECRET = "s".repeat(40);
const ID = "3f0c1c7e-8f5e-4c1e-9d55-0d6a1d1f6b11";

describe("signDeviceId / parseDeviceCookie", () => {
  it("round-trips a signed id", () => {
    expect(parseDeviceCookie(signDeviceId(ID, SECRET), SECRET)).toBe(ID);
  });

  it.each([
    ["unsigned", ID],
    ["empty", ""],
    ["wrong secret", signDeviceId(ID, "x".repeat(40))],
    ["tampered id", signDeviceId(ID, SECRET).replace("3f0c", "4f0c")],
    ["tampered signature", `${signDeviceId(ID, SECRET).slice(0, -2)}AA`],
    ["not a uuid", signDeviceId("hello", SECRET)],
  ])("ignores a %s value", (_label, value) => {
    expect(parseDeviceCookie(value, SECRET)).toBeNull();
  });

  it("ignores undefined", () => {
    expect(parseDeviceCookie(undefined, SECRET)).toBeNull();
  });
});

describe("issueDeviceCookie", () => {
  const opts = { key: SECRET, secure: true };

  it("creates a new signed cookie when none exists", () => {
    const store = new FakeCookieStore();
    const result = issueDeviceCookie(store, opts);
    expect(result.existing).toBe(false);
    const write = store.lastWrite(DEVICE_COOKIE);
    expect(write?.value).toBe(signDeviceId(result.id, SECRET));
    expect(write?.options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 400 * 24 * 60 * 60,
    });
  });

  it("keeps a valid id and refreshes the cookie", () => {
    const store = new FakeCookieStore();
    store.jar.set(DEVICE_COOKIE, signDeviceId(ID, SECRET));
    const result = issueDeviceCookie(store, opts);
    expect(result).toEqual({ id: ID, existing: true });
    expect(store.writes).toHaveLength(1);
  });

  it("replaces a tampered value with a new id", () => {
    const store = new FakeCookieStore();
    store.jar.set(DEVICE_COOKIE, `${ID}.forged`);
    const result = issueDeviceCookie(store, opts);
    expect(result.existing).toBe(false);
    expect(result.id).not.toBe(ID);
    expect(parseDeviceCookie(store.jar.get(DEVICE_COOKIE), SECRET)).toBe(result.id);
  });

  it("is not Secure over plain http", () => {
    const store = new FakeCookieStore();
    issueDeviceCookie(store, { key: SECRET, secure: false });
    expect(store.lastWrite(DEVICE_COOKIE)?.options).toMatchObject({ secure: false });
  });
});
