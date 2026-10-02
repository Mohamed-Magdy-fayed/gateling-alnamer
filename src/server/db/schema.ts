import { desc, relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { LocalizedText } from "@/lib/localized-text";
import { citext } from "./types";

export const userRole = pgEnum("user_role", ["student", "parent", "teacher", "admin", "reviewer"]);
export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const verificationPurpose = pgEnum("verification_purpose", [
  "email_verify",
  "password_reset",
]);
export const emailStatus = pgEnum("email_status", ["queued", "sent", "failed"]);
export const deviceRevokeReason = pgEnum("device_revoke_reason", ["self", "admin", "expired"]);
export const deviceRemovalKind = pgEnum("device_removal_kind", ["self", "admin"]);

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: citext("email").unique(),
    username: citext("username").unique(),
    role: userRole("role").notNull().default("student"),
    isSample: boolean("is_sample").notNull().default(false),
    dateOfBirth: date("date_of_birth"),
    guardianConsentAt: timestamp("guardian_consent_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    locale: text("locale"),
    status: userStatus("status").notNull().default("active"),
    publicNumber: text("public_number").unique(),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    createdAt,
  },
  (t) => [
    check(
      "users_username_format",
      sql`${t.username} IS NULL OR (char_length(${t.username}) BETWEEN 3 AND 20 AND lower(${t.username}::text) ~ '^[a-z0-9_.]+$')`,
    ),
  ],
);

export const credentials = pgTable("credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceKey: uuid("device_key").notNull(),
    label: text("label"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: deviceRevokeReason("revoked_reason"),
  },
  (t) => [
    uniqueIndex("devices_user_key_active_uq")
      .on(t.userId, t.deviceKey)
      .where(sql`${t.revokedAt} IS NULL`),
    index("devices_last_seen_active_idx").on(t.lastSeenAt).where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const deviceRemovals = pgTable(
  "device_removals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    kind: deviceRemovalKind("kind").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt,
  },
  (t) => [index("device_removals_user_created_idx").on(t.userId, desc(t.createdAt))],
);

export const preSessions = pgTable("pre_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deviceKey: uuid("device_key").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    twoFactorVerified: boolean("two_factor_verified").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: verificationPurpose("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    emailStatus: emailStatus("email_status").notNull().default("queued"),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index("verification_codes_user_purpose_created_idx").on(t.userId, t.purpose, desc(t.createdAt)),
  ],
);

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
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "restrict" }),
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

// Fixed-window counters for the Postgres rate-limit fallback (src/server/rate-limit/postgres.ts).
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

// ---- Catalogue (W1) ----------------------------------------------------------------------
// Teacher-authored text is LocalizedText jsonb: an object with at least one of ar / en.

export const teacherStatus = pgEnum("teacher_status", [
  "applied",
  "approved",
  "rejected",
  "suspended",
]);
export const categoryType = pgEnum("category_type", ["curriculum", "grade", "subject"]);
export const courseStatus = pgEnum("course_status", [
  "draft",
  "in_review",
  "published",
  "hidden",
  "archived",
]);
export const accessKind = pgEnum("access_kind", ["fixed_end", "duration_days"]);
export const lessonKind = pgEnum("lesson_kind", ["video", "pdf", "image", "quiz"]);
export const mediaKind = pgEnum("media_kind", ["video", "pdf", "image"]);
export const mediaProvider = pgEnum("media_provider", [
  "bunny",
  "mock",
  "sample",
  "firebase",
  "local",
]);
export const mediaStatus = pgEnum("media_status", ["pending", "processing", "ready", "failed"]);

const isSample = boolean("is_sample").notNull().default(false);

const isTextObject = (column: AnyPgColumn) => sql`jsonb_typeof(${column}) = 'object'`;

export const teacherProfiles = pgTable(
  "teacher_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    publicName: jsonb("public_name").$type<LocalizedText>().notNull(),
    bio: jsonb("bio").$type<LocalizedText>().notNull(),
    status: teacherStatus("status").notNull().default("applied"),
    commissionRateBp: integer("commission_rate_bp"),
    termsVersionAccepted: text("terms_version_accepted"),
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    isSample,
    createdAt,
  },
  (t) => [
    check("teacher_profiles_public_name_object", isTextObject(t.publicName)),
    check("teacher_profiles_bio_object", isTextObject(t.bio)),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    type: categoryType("type").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
    slug: text("slug").notNull(),
    nameAr: text("name_ar").notNull(),
    nameEn: text("name_en").notNull(),
    sort: integer("sort").notNull().default(0),
    isSample,
    createdAt,
  },
  (t) => [unique("categories_type_slug_unique").on(t.type, t.slug)],
);

export const mediaAssets = pgTable("media_assets", {
  id: uuid("id").primaryKey(),
  kind: mediaKind("kind").notNull(),
  provider: mediaProvider("provider").notNull(),
  providerId: text("provider_id"),
  storageKey: text("storage_key"),
  status: mediaStatus("status").notNull().default("pending"),
  durationS: integer("duration_s"),
  bytes: bigint("bytes", { mode: "number" }),
  isSample,
  createdAt,
});

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: courseStatus("status").notNull().default("draft"),
    publishedRevisionId: uuid("published_revision_id").references(
      (): AnyPgColumn => courseRevisions.id,
      { onDelete: "restrict" },
    ),
    pendingRevisionId: uuid("pending_revision_id").references(
      (): AnyPgColumn => courseRevisions.id,
      { onDelete: "restrict" },
    ),
    isSample,
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("courses_status_idx").on(t.status), index("courses_teacher_idx").on(t.teacherId)],
);

export const courseRevisions = pgTable(
  "course_revisions",
  {
    id: uuid("id").primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references((): AnyPgColumn => courses.id, { onDelete: "cascade" }),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText>().notNull(),
    coverImageKey: text("cover_image_key"),
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
    accessKind: accessKind("access_kind").notNull(),
    accessEndAt: timestamp("access_end_at", { withTimezone: true }),
    accessDays: integer("access_days"),
    estimatedHours: integer("estimated_hours"),
    createdBy: uuid("created_by").references(() => users.id),
    isSample,
    createdAt,
  },
  (t) => [
    check("course_revisions_price_nonneg", sql`${t.priceMinor} >= 0`),
    check("course_revisions_title_object", isTextObject(t.title)),
    check("course_revisions_description_object", isTextObject(t.description)),
    check(
      "course_revisions_access_consistent",
      sql`(${t.accessKind} = 'fixed_end' and ${t.accessEndAt} is not null and ${t.accessDays} is null)
        or (${t.accessKind} = 'duration_days' and ${t.accessDays} > 0 and ${t.accessEndAt} is null)`,
    ),
    index("course_revisions_course_idx").on(t.courseId),
  ],
);

export const courseCategories = pgTable(
  "course_categories",
  {
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    isSample,
  },
  (t) => [
    primaryKey({ columns: [t.courseId, t.categoryId] }),
    index("course_categories_category_idx").on(t.categoryId),
  ],
);

export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull(),
    publishedRevisionId: uuid("published_revision_id").references(
      (): AnyPgColumn => sectionRevisions.id,
      { onDelete: "restrict" },
    ),
    pendingRevisionId: uuid("pending_revision_id").references(
      (): AnyPgColumn => sectionRevisions.id,
      { onDelete: "restrict" },
    ),
    isSample,
    createdAt,
  },
  (t) => [index("sections_course_sort_idx").on(t.courseId, t.sort)],
);

export const sectionRevisions = pgTable(
  "section_revisions",
  {
    id: uuid("id").primaryKey(),
    sectionId: uuid("section_id")
      .notNull()
      .references((): AnyPgColumn => sections.id, { onDelete: "cascade" }),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    isSample,
    createdAt,
  },
  (t) => [check("section_revisions_title_object", isTextObject(t.title))],
);

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    kind: lessonKind("kind").notNull(),
    sort: integer("sort").notNull(),
    publishedRevisionId: uuid("published_revision_id").references(
      (): AnyPgColumn => lessonRevisions.id,
      { onDelete: "restrict" },
    ),
    pendingRevisionId: uuid("pending_revision_id").references(
      (): AnyPgColumn => lessonRevisions.id,
      { onDelete: "restrict" },
    ),
    isSample,
    createdAt,
  },
  (t) => [index("lessons_section_sort_idx").on(t.sectionId, t.sort)],
);

export const lessonRevisions = pgTable(
  "lesson_revisions",
  {
    id: uuid("id").primaryKey(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references((): AnyPgColumn => lessons.id, { onDelete: "cascade" }),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    body: jsonb("body").$type<LocalizedText>(),
    isFreePreview: boolean("is_free_preview").notNull().default(false),
    durationMinutes: integer("duration_minutes"),
    videoAssetId: uuid("video_asset_id").references(() => mediaAssets.id),
    fileAssetId: uuid("file_asset_id").references(() => mediaAssets.id),
    quizId: uuid("quiz_id"), // FK added in T4
    isSample,
    createdAt,
  },
  (t) => [
    check("lesson_revisions_title_object", isTextObject(t.title)),
    check(
      "lesson_revisions_body_object",
      sql`${t.body} is null or jsonb_typeof(${t.body}) = 'object'`,
    ),
  ],
);

export const usersRelations = relations(users, ({ one }) => ({
  credentials: one(credentials, { fields: [users.id], references: [credentials.userId] }),
}));

export type User = typeof users.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
