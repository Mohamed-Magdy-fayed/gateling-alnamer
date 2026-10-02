import type { Redis } from "@upstash/redis";

/** In-memory stand-in for the few Redis commands the session cache uses. Records TTLs. */
export class FakeRedis {
  readonly values = new Map<string, unknown>();
  readonly sets = new Map<string, Set<string>>();
  readonly ttls = new Map<string, number>();
  failing = false;
  readonly calls: string[] = [];

  private guard(op: string): void {
    this.calls.push(op);
    if (this.failing) throw new Error("redis down");
  }

  async get(key: string): Promise<unknown> {
    this.guard("get");
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: unknown, opts?: { ex?: number }): Promise<"OK"> {
    this.guard("set");
    this.values.set(key, value);
    if (opts?.ex !== undefined) this.ttls.set(key, opts.ex);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    this.guard("del");
    let n = 0;
    for (const key of keys) {
      if (this.values.delete(key) || this.sets.delete(key)) n++;
      this.ttls.delete(key);
    }
    return n;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    this.guard("sadd");
    const set = this.sets.get(key) ?? new Set<string>();
    for (const m of members) set.add(m);
    this.sets.set(key, set);
    return members.length;
  }

  async smembers(key: string): Promise<string[]> {
    this.guard("smembers");
    return [...(this.sets.get(key) ?? [])];
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    this.guard("srem");
    const set = this.sets.get(key);
    for (const m of members) set?.delete(m);
    return members.length;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.guard("expire");
    this.ttls.set(key, seconds);
    return 1;
  }

  asRedis(): Redis {
    return this as unknown as Redis;
  }
}
