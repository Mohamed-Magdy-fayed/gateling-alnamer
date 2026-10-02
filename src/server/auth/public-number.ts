import { sql } from "drizzle-orm";

// Anything with an `execute` (a Drizzle db or transaction).
type SqlRunner = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };

export const PUBLIC_NUMBER_PREFIX = "AN";

// Next student-facing number ("AN100001", ...) from user_public_number_seq. Call inside the sign-up transaction.
export async function nextPublicNumber(tx: SqlRunner): Promise<string> {
  const result = await tx.execute(sql`select nextval('user_public_number_seq') as n`);
  const rows = (Array.isArray(result) ? result : []) as Array<{ n: string | number | bigint }>;
  const first = rows[0];
  if (!first) throw new Error("user_public_number_seq returned no value");
  return `${PUBLIC_NUMBER_PREFIX}${String(first.n)}`;
}
