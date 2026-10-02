export type CookieWrite = {
  name: string;
  value: string;
  options: Record<string, unknown> | undefined;
};

/** Minimal `cookies()` store: a jar plus a log of every write, so tests can assert on options. */
export class FakeCookieStore {
  readonly jar = new Map<string, string>();
  readonly writes: CookieWrite[] = [];
  /** Mimics a server-component render, where Next refuses cookie writes. */
  readOnly = false;

  get(name: string): { name: string; value: string } | undefined {
    const value = this.jar.get(name);
    return value === undefined ? undefined : { name, value };
  }

  set(name: string, value: string, options?: Record<string, unknown>): void {
    if (this.readOnly)
      throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
    this.writes.push({ name, value, options });
    if (value === "" || options?.maxAge === 0) this.jar.delete(name);
    else this.jar.set(name, value);
  }

  delete(name: string): void {
    this.set(name, "", { maxAge: 0 });
  }

  lastWrite(name: string): CookieWrite | undefined {
    return [...this.writes].reverse().find((w) => w.name === name);
  }
}
