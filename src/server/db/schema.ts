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
export const parentLinkSource = pgEnum("parent_link_source", ["created_child", "invite"]);
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
    /** The parent who created this child account; RESTRICT because users are never hard-deleted (D23). */
    createdByParentId: uuid("created_by_parent_id").references((): AnyPgColumn => users.id, {
      onDelete: "restrict",
    }),
    createdAt,
  },
  (t) => [
    check(
      "users_username_format",
      sql`${t.username} IS NULL OR (char_length(${t.username}) BETWEEN 3 AND 20 AND lower(${t.username}::text) ~ '^[a-z0-9_.]+$')`,
    ),
  ],
);

export const parentLinks = pgTable(
  "parent_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: parentLinkSource("source").notNull(),
    createdAt,
  },
  (t) => [
    unique("parent_links_parent_student_unique").on(t.parentId, t.studentId),
    index("parent_links_student_idx").on(t.studentId),
  ],
);

export const linkInvites = pgTable(
  "link_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedBy: uuid("redeemed_by").references(() => users.id),
    createdAt,
  },
  (t) => [index("link_invites_parent_idx").on(t.parentId)],
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
    /** Set for an "add email" code: the address that becomes the account's only after verification. */
    pendingEmail: citext("pending_email"),
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
    quizId: uuid("quiz_id").references((): AnyPgColumn => quizzes.id, { onDelete: "restrict" }),
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

// ---- Orders and access (T1) --------------------------------------------------------------
// Money columns are integer minor units (bigint, mode "number"); P1 wraps them in the Money type.

export const orderStatus = pgEnum("order_status", [
  "pending",
  "paid",
  "paid_duplicate",
  "expired",
  "failed",
  "refunded",
  "cancelled",
]);
export const orderChannel = pgEnum("order_channel", ["online", "manual"]);
export const orderCollector = pgEnum("order_collector", ["platform", "teacher"]);
export const refundFlagReason = pgEnum("refund_flag_reason", [
  "duplicate",
  "paid_after_access_end",
  "over_cap_coupon",
]);
export const entitlementSource = pgEnum("entitlement_source", ["order", "manual", "admin_grant"]);
export const mockInvoiceStatus = pgEnum("mock_invoice_status", [
  "pending",
  "paid",
  "failed",
  "expired",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey(),
    /** 8 Crockford base32 characters, stored without the dash; shown as XXXX-XXXX. */
    number: text("number").notNull().unique(),
    buyerId: uuid("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    beneficiaryStudentId: uuid("beneficiary_student_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    /** The terms bought; the access end is computed from this revision. */
    courseRevisionId: uuid("course_revision_id")
      .notNull()
      .references(() => courseRevisions.id, { onDelete: "restrict" }),
    status: orderStatus("status").notNull().default("pending"),
    listPriceMinor: bigint("list_price_minor", { mode: "number" }).notNull(),
    discountMinor: bigint("discount_minor", { mode: "number" }).notNull().default(0),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    couponId: uuid("coupon_id"), // FK added in P6
    teacherRateBp: integer("teacher_rate_bp").notNull(),
    channel: orderChannel("channel").notNull().default("online"),
    collectedBy: orderCollector("collected_by").notNull().default("platform"),
    gatewayInvoiceId: text("gateway_invoice_id"),
    gatewayPaymentId: text("gateway_payment_id"),
    gatewayFeeMinor: bigint("gateway_fee_minor", { mode: "number" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    refundFlag: refundFlagReason("refund_flag"),
    isSample,
    createdAt,
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "orders_amounts_valid",
      sql`${t.listPriceMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.amountMinor} >= 0 and ${t.amountMinor} = ${t.listPriceMinor} - ${t.discountMinor}`,
    ),
    check("orders_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check(
      "orders_paid_at_matches_status",
      sql`(${t.paidAt} is not null) = (${t.status} in ('paid', 'paid_duplicate', 'refunded'))`,
    ),
    check("orders_teacher_rate_range", sql`${t.teacherRateBp} between 0 and 10000`),
    uniqueIndex("orders_one_pending_idx")
      .on(t.beneficiaryStudentId, t.courseId)
      .where(sql`status = 'pending'`),
    index("orders_buyer_idx").on(t.buyerId),
    index("orders_beneficiary_idx").on(t.beneficiaryStudentId),
    uniqueIndex("orders_gateway_invoice_uq")
      .on(t.gatewayInvoiceId)
      .where(sql`gateway_invoice_id is not null`),
  ],
);

export const entitlements = pgTable(
  "entitlements",
  {
    id: uuid("id").primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    source: entitlementSource("source").notNull(),
    /** The grant upsert key: one entitlement per order. */
    orderId: uuid("order_id")
      .unique()
      .references(() => orders.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokeReason: text("revoke_reason"),
    isSample,
    createdAt,
  },
  (t) => [
    check("entitlements_window_valid", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "entitlements_order_source_has_order",
      sql`${t.source} <> 'order' or ${t.orderId} is not null`,
    ),
    index("entitlements_student_course_idx").on(t.studentId, t.courseId),
  ],
);

// Two-factor sign-in for staff (A4). The TOTP seed is sealed (AES-256-GCM, sub-key "totp").
export const totpSecrets = pgTable("totp_secrets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretEnc: text("secret_enc").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  /** The last accepted 30-second step: a code is never accepted twice. */
  lastStep: bigint("last_step", { mode: "number" }),
  createdAt,
});

export const recoveryCodes = pgTable(
  "recovery_codes",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** HMAC of the normalised code under the "recovery" sub-key. */
    codeHash: text("code_hash").notNull().unique(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("recovery_codes_user_idx").on(t.userId)],
);

export const passkeys = pgTable(
  "passkeys",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array(),
    name: text("name"),
    createdAt,
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("passkeys_user_idx").on(t.userId)],
);

export const questionKind = pgEnum("question_kind", ["mcq", "true_false"]);

/** One answer option; `true_false` questions use the ids `true` and `false`. */
export type QuestionOption = { id: string; text: LocalizedText };

export const questionBanks = pgTable("question_banks", {
  id: uuid("id").primaryKey(),
  teacherId: uuid("teacher_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  title: jsonb("title").$type<LocalizedText>().notNull(),
  isSample,
  createdAt,
});

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey(),
    bankId: uuid("bank_id")
      .notNull()
      .references(() => questionBanks.id, { onDelete: "restrict" }),
    kind: questionKind("kind").notNull(),
    body: jsonb("body").$type<LocalizedText>().notNull(),
    options: jsonb("options").$type<QuestionOption[]>().notNull(),
    // The correct option id. Read only in src/server/access/** (MASTER-PLAN 3.2, static test).
    correct: text("correct").notNull(),
    explanation: jsonb("explanation").$type<LocalizedText>(),
    isSample,
    createdAt,
  },
  (t) => [
    check("questions_body_object", isTextObject(t.body)),
    check("questions_options_array", sql`jsonb_typeof(${t.options}) = 'array'`),
    index("questions_bank_idx").on(t.bankId),
  ],
);

export const quizzes = pgTable(
  "quizzes",
  {
    id: uuid("id").primaryKey(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    timeLimitS: integer("time_limit_s"),
    maxAttempts: integer("max_attempts").notNull().default(3),
    passPct: integer("pass_pct").notNull().default(60),
    isSample,
    createdAt,
  },
  (t) => [
    check("quizzes_title_object", isTextObject(t.title)),
    check("quizzes_max_attempts", sql`${t.maxAttempts} >= 1`),
    check("quizzes_pass_pct", sql`${t.passPct} between 0 and 100`),
    check("quizzes_time_limit", sql`${t.timeLimitS} is null or ${t.timeLimitS} > 0`),
    index("quizzes_course_idx").on(t.courseId),
  ],
);

export const quizQuestions = pgTable(
  "quiz_questions",
  {
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    sort: integer("sort").notNull(),
  },
  (t) => [primaryKey({ columns: [t.quizId, t.questionId] })],
);

export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").primaryKey(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    quizId: uuid("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "restrict" }),
    attemptNo: integer("attempt_no").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    scorePct: integer("score_pct"),
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    isSample,
  },
  (t) => [
    unique("quiz_attempts_student_quiz_no_unique").on(t.studentId, t.quizId, t.attemptNo),
    check(
      "quiz_attempts_score_range",
      sql`${t.scorePct} is null or ${t.scorePct} between 0 and 100`,
    ),
    check(
      "quiz_attempts_score_when_submitted",
      sql`(${t.scorePct} is null) = (${t.submittedAt} is null)`,
    ),
    index("quiz_attempts_student_quiz_idx").on(t.studentId, t.quizId),
  ],
);

// Backs the mock gateway (demo and tests) so the hosted page and the status query share state.
export const mockGatewayInvoices = pgTable("mock_gateway_invoices", {
  id: text("id").primaryKey(),
  customerReference: text("customer_reference").notNull(),
  amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
  currency: text("currency").notNull(),
  status: mockInvoiceStatus("status").notNull().default("pending"),
  createdAt,
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentId: text("payment_id"),
});

export const usersRelations = relations(users, ({ one }) => ({
  credentials: one(credentials, { fields: [users.id], references: [credentials.userId] }),
}));

export type User = typeof users.$inferSelect;
export type UserRole = (typeof userRole.enumValues)[number];
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type RefundFlagReason = (typeof refundFlagReason.enumValues)[number];
export type QuizAttemptRow = typeof quizAttempts.$inferSelect;
