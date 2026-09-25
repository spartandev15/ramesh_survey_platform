import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/** A shop is the tenant whose branding and authorized users apply. */
export const shop = pgTable("shop", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Stable public identifier for the public survey URL (SR-13). Never the internal id.
  publicSlug: text("public_slug").notNull().unique(),
  // Isolated internal test shop; its data never enters production reporting (SR-03, SR-37).
  isTestShop: boolean("is_test_shop").notNull().default(false),
  timezone: text("timezone").notNull().default("America/New_York"),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const psgRole = pgEnum("psg_role", ["psg_admin", "psg_operator", "psg_reviewer"]);

/** PSG staff roles. A user may hold several. Absence means the user is not PSG staff. */
export const psgStaffRole = pgTable(
  "psg_staff_role",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: psgRole("role").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: text("granted_by").references(() => user.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const shopRole = pgEnum("shop_role", ["shop_user"]);

/** Which shops a shop user may see. Checked server-side on every shop-scoped operation (SR-01). */
export const shopMembership = pgTable(
  "shop_membership",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id, { onDelete: "cascade" }),
    role: shopRole("role").notNull().default("shop_user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.shopId] }), index("shop_membership_shop_idx").on(t.shopId)],
);

export const actorType = pgEnum("actor_type", ["user", "system", "respondent"]);

/**
 * Append-only operational history (PDF: CaseNote/AuditEvent). A database
 * trigger in the migrations rejects UPDATE and DELETE.
 */
export const auditEvent = pgTable(
  "audit_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: actorType("actor_type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id),
    shopId: uuid("shop_id").references(() => shop.id),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
  },
  (t) => [
    index("audit_event_subject_idx").on(t.subjectType, t.subjectId),
    index("audit_event_shop_time_idx").on(t.shopId, t.occurredAt.desc()),
    index("audit_event_actor_idx").on(t.actorUserId).where(sql`${t.actorUserId} is not null`),
  ],
);

/** A survey (PDF: InstrumentVersion.survey_id). Its content lives in versions. */
export const instrument = pgTable("instrument", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stable machine name used in exports and reports; never reused.
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").references(() => user.id),
});

export const instrumentVersionStatus = pgEnum("instrument_version_status", ["draft", "published"]);

/**
 * One version of a survey: questions, scoring, alert and suppression rules
 * (SR-15). A trigger in the migrations rejects any UPDATE or DELETE of a
 * published version, so published content and its hash can never change.
 */
export const instrumentVersion = pgTable(
  "instrument_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instrument.id),
    version: integer("version").notNull(),
    status: instrumentVersionStatus("status").notNull().default("draft"),
    // Test versions may never be used for Live customers (AT-14). Only a
    // version built from PSG-verified source content is published with false.
    isTest: boolean("is_test").notNull().default(true),
    definition: jsonb("definition").notNull(),
    // SHA-256 of the canonical definition, fixed at publication (PDF: source hash).
    definitionHash: text("definition_hash"),
    // Provenance of the content, e.g. the approved source export and its checksum.
    sourceNote: text("source_note"),
    // Optimistic concurrency for draft edits: a stale editor gets a conflict.
    revision: integer("revision").notNull().default(1),
    basedOnVersionId: uuid("based_on_version_id").references((): AnyPgColumn => instrumentVersion.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => user.id),
  },
  (t) => [
    unique("instrument_version_number_unique").on(t.instrumentId, t.version),
    // At most one open draft per survey, so two editors cannot fork it silently.
    uniqueIndex("instrument_version_one_draft").on(t.instrumentId).where(sql`${t.status} = 'draft'`),
    check("instrument_version_published_complete", sql`${t.status} = 'draft' OR (${t.definitionHash} IS NOT NULL AND ${t.publishedAt} IS NOT NULL)`),
    check("instrument_version_positive", sql`${t.version} > 0 AND ${t.revision} > 0`),
  ],
);

/**
 * Durable survey entitlement (PDF: Invitation). Pinned to one published
 * instrument version (SR-15). Import-created invitations add their repair
 * visit in a later migration; test invitations never contact customers (SR-03).
 */
export const invitation = pgTable(
  "invitation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    instrumentVersionId: uuid("instrument_version_id")
      .notNull()
      .references(() => instrumentVersion.id),
    isTest: boolean("is_test").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
  },
  (t) => [index("invitation_shop_idx").on(t.shopId), index("invitation_version_idx").on(t.instrumentVersionId)],
);

/**
 * Replaceable bearer access to an invitation (PDF: AccessToken). Only a
 * SHA-256 hash is stored; the token itself exists only in the link (SR-12, SR-40).
 */
export const accessToken = pgTable(
  "access_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitation.id),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("access_token_invitation_idx").on(t.invitationId), check("access_token_expiry_after_issue", sql`${t.expiresAt} > ${t.issuedAt}`)],
);

export const responseSource = pgEnum("response_source", ["online", "public", "paper"]);
export const responseStatus = pgEnum("response_status", ["draft", "submitted"]);

/**
 * A draft or submitted answer set (PDF: Response). Drafts never enter scores
 * (SR-16). Once submitted, a trigger locks the answer-defining columns
 * (SR-17); corrections append to response_revision instead (SR-20).
 */
export const surveyResponse = pgTable(
  "survey_response",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invitationId: uuid("invitation_id").references(() => invitation.id),
    shopId: uuid("shop_id").references(() => shop.id),
    instrumentVersionId: uuid("instrument_version_id")
      .notNull()
      .references(() => instrumentVersion.id),
    source: responseSource("source").notNull(),
    status: responseStatus("status").notNull().default("draft"),
    isTest: boolean("is_test").notNull(),
    draftAnswers: jsonb("draft_answers").notNull().default({}),
    // Optimistic concurrency for autosave: a stale tab cannot overwrite newer answers (AT-16).
    draftRevision: integer("draft_revision").notNull().default(0),
    draftSavedAt: timestamp("draft_saved_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    // Idempotent submit (PDF 05): same key and body return the original result.
    submitRequestKey: text("submit_request_key"),
    submitPayloadHash: text("submit_payload_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One online response per invitation; later paper/public duplicates are reviewed separately (SR-19).
    uniqueIndex("survey_response_one_online_per_invitation").on(t.invitationId).where(sql`${t.source} = 'online'`),
    index("survey_response_shop_submitted_idx").on(t.shopId, t.submittedAt.desc()),
    check("survey_response_submitted_complete", sql`${t.status} = 'draft' OR (${t.submittedAt} IS NOT NULL AND ${t.submitPayloadHash} IS NOT NULL)`),
  ],
);

/**
 * Append-only answer history (PDF: ResponseRevision). Revision 1 is the
 * original submission; audited corrections append later revisions (SR-20).
 * Outcomes record the rule version that produced them (AT-15).
 */
export const responseRevision = pgTable(
  "response_revision",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => surveyResponse.id),
    revision: integer("revision").notNull(),
    answers: jsonb("answers").notNull(),
    outcomes: jsonb("outcomes").notNull(),
    definitionHash: text("definition_hash").notNull(),
    evaluatorVersion: integer("evaluator_version").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("response_revision_number_unique").on(t.responseId, t.revision)],
);
