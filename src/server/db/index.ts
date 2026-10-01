import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/server/env";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as { alnamerDb?: Db };

export function db(): Db {
  if (!globalForDb.alnamerDb) {
    const client = postgres(serverEnv().DATABASE_URL, { max: 5, prepare: false });
    globalForDb.alnamerDb = drizzle(client, { schema });
  }
  return globalForDb.alnamerDb;
}
