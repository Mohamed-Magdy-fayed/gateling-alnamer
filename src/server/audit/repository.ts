import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { type DbExecutor, db } from "@/server/db";
import { type AuditLogRow, auditLog } from "@/server/db/schema";
import { redact } from "./redact";

export interface AuditEntry {
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  before?: unknown;
  after?: unknown;
  ipHash?: string | null;
}

export interface AuditQuery {
  subjectType?: string;
  subjectId?: string;
  actorId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function redactedOrNull(value: unknown): unknown {
  return value === undefined || value === null ? null : redact(value);
}

/** Insert-only. Call inside the transaction of the action being audited; before/after are redacted. */
export async function writeAudit(tx: DbExecutor, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    id: uuidv7(),
    actorId: entry.actorId,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId ?? null,
    before: redactedOrNull(entry.before),
    after: redactedOrNull(entry.after),
    ipHash: entry.ipHash ?? null,
  });
}

/** Newest first. */
export async function listAudit(
  query: AuditQuery = {},
  executor: DbExecutor = db(),
): Promise<AuditLogRow[]> {
  const conditions = [
    query.subjectType ? eq(auditLog.subjectType, query.subjectType) : undefined,
    query.subjectId ? eq(auditLog.subjectId, query.subjectId) : undefined,
    query.actorId ? eq(auditLog.actorId, query.actorId) : undefined,
  ].filter((c) => c !== undefined);

  return executor
    .select()
    .from(auditLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.at))
    .limit(Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
}
