import { desc, relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["student", "parent", "teacher", "admin"]);

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: userRole("role").notNull().default("student"),
  createdAt,
});

export const credentials = pgTable("credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
});

export const passwordResetCodes = pgTable("password_reset_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt,
});

export const deviceLimitMode = pgEnum("device_limit_mode", ["strict", "soft"]);

// One row (id = 1), inserted by the audit_trigger_and_settings_row migration.
export const platformSettings = pgTable(
  "platform_settings",
  {
    id: smallint("id").primaryKey(),
    currency: text("currency").notNull().default("AED"),
    deviceLimit: integer("device_limit").notNull().default(2),
    deviceLimitMode: deviceLimitMode("device_limit_mode").notNull().default("strict"),
    refundWindowDays: integer("refund_window_days").default(7),
    refundMaxOpenedPct: integer("refund_max_opened_pct").default(25),
    defaultCommissionBp: integer("default_commission_bp").default(7000),
    gatewayFeeBp: integer("gateway_fee_bp").default(250),
    invoiceTtlHours: integer("invoice_ttl_hours").default(24),
    sampleHiddenAt: timestamp("sample_hidden_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("platform_settings_single_row", sql`${t.id} = 1`)],
);

// Append-only: audit_log_immutable() rejects UPDATE and DELETE. Ids are UUIDv7 made in the app.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ipHash: text("ip_hash"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_subject_idx").on(t.subjectType, t.subjectId, desc(t.at)),
    index("audit_log_actor_idx").on(t.actorId, desc(t.at)),
  ],
);

export const usersRelations = relations(users, ({ one }) => ({
  credentials: one(credentials, { fields: [users.id], references: [credentials.userId] }),
}));

export type User = typeof users.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
