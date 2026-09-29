import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
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

export const shopMode = pgEnum("shop_mode", ["test", "live", "paused"]);

/**
 * PSG-managed survey settings, one row per shop (PDF: ShopSurveySettings;
 * SR-02..SR-05, SR-26). Branding and timezone stay on `shop`. Changes are
 * audited; `revision` makes a stale editor get a conflict. A trigger in the
 * migrations keeps TEST versions and internal test shops out of Live (AT-14).
 */
export const shopSurveySettings = pgTable(
  "shop_survey_settings",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shop.id, { onDelete: "cascade" }),
    mode: shopMode("mode").notNull().default("test"),
    // First time the shop went Live. Imports before this never auto-send (SR-04).
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    // Start of the current Live period; null while Test or Paused. Only
    // imports after this may auto-send; earlier ones wait for PSG selection.
    liveSince: timestamp("live_since", { withTimezone: true }),
    // Inclusive shop-local delivery date (SR-05).
    deliveryCutoff: date("delivery_cutoff", { mode: "string" }),
    // Version assigned to new invitations. Issued invitations keep their own version (SR-15, AT-44).
    instrumentVersionId: uuid("instrument_version_id").references((): AnyPgColumn => instrumentVersion.id),
    // This shop's own questions, shown after the core; never scored (SR-45). Issued invitations keep their own.
    additionVersionId: uuid("addition_version_id").references((): AnyPgColumn => instrumentVersion.id),
    reminderDelayDays: integer("reminder_delay_days").notNull().default(7),
    linkLifetimeDays: integer("link_lifetime_days").notNull().default(90),
    alertRecipients: text("alert_recipients").array().notNull().default(sql`'{}'::text[]`),
    // Set when PSG confirms this shop's legacy send/completion history is
    // loaded. Until then production rows are held, never assumed eligible (AT-08).
    legacyCoverageConfirmedAt: timestamp("legacy_coverage_confirmed_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => user.id),
  },
  (t) => [
    check("shop_survey_settings_reminder_range", sql`${t.reminderDelayDays} BETWEEN 1 AND 60`),
    check("shop_survey_settings_lifetime_range", sql`${t.linkLifetimeDays} BETWEEN 1 AND 365`),
    check(
      "shop_survey_settings_outreach_ready",
      sql`${t.mode} = 'test' OR (${t.deliveryCutoff} IS NOT NULL AND ${t.instrumentVersionId} IS NOT NULL AND ${t.activatedAt} IS NOT NULL)`,
    ),
    check("shop_survey_settings_live_since", sql`(${t.mode} = 'live') = (${t.liveSince} IS NOT NULL)`),
  ],
);

/**
 * Internal addresses that Test mode and test records may email (SR-03, AT-03).
 * An entry is a full address or a whole domain written as "@domain". The email
 * dispatcher checks this at send time, not only the UI.
 */
export const testRecipientAllowlist = pgTable("test_recipient_allowlist", {
  id: uuid("id").primaryKey().defaultRandom(),
  entry: text("entry").notNull().unique(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").references(() => user.id),
});

/** A survey (PDF: InstrumentVersion.survey_id). Its content lives in versions. */
export const instrument = pgTable("instrument", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stable machine name used in exports and reports; never reused.
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  // Set only for a shop's own additional questions (SR-45). Null is the shared PSG core.
  shopId: uuid("shop_id").references((): AnyPgColumn => shop.id),
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

export const importKind = pgEnum("import_kind", ["visits", "legacy_ledger", "legacy_cases", "opt_outs"]);
export const importBatchStatus = pgEnum("import_batch_status", ["preview", "committed"]);
export const importRowAction = pgEnum("import_row_action", ["created", "reused", "held", "excluded", "rejected"]);

/**
 * One uploaded file (PDF: ImportBatch; SR-06). Rows are staged at upload and
 * processed at commit. Test batches create only test records (SR-03).
 */
export const importBatch = pgTable(
  "import_batch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    kind: importKind("kind").notNull(),
    isTest: boolean("is_test").notNull(),
    sourceSystem: text("source_system").notNull(),
    fileName: text("file_name").notNull(),
    // SHA-256 of the uploaded bytes, for provenance and spotting a repeated file.
    sourceHash: text("source_hash").notNull(),
    headers: text("headers").array().notNull(),
    // Column mapping PSG confirmed: field name -> source header.
    mapping: jsonb("mapping").notNull().default({}),
    status: importBatchStatus("status").notNull().default("preview"),
    // Changes when the mapping changes, so a commit matches the preview PSG saw.
    revision: integer("revision").notNull().default(1),
    rowCount: integer("row_count").notNull(),
    counts: jsonb("counts"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    committedBy: text("committed_by").references(() => user.id),
  },
  (t) => [index("import_batch_shop_time_idx").on(t.shopId, t.createdAt.desc())],
);

/** One source row with its stable outcome (PDF: ImportRow). Raw values are kept as received. */
export const importRow = pgTable(
  "import_row",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatch.id),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").notNull(),
    action: importRowAction("action"),
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    visitId: uuid("visit_id").references((): AnyPgColumn => repairVisit.id),
    invitationId: uuid("invitation_id").references((): AnyPgColumn => invitation.id),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [unique("import_row_number_unique").on(t.batchId, t.rowNumber)],
);

/** A shop's customer. Email is contact data, never the visit identity (SR-07). */
export const customer = pgTable(
  "customer",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    isTest: boolean("is_test").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    // Trimmed and lower-cased only (PDF 04); no provider-specific rewriting.
    emailNormalized: text("email_normalized"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customer_shop_email_idx").on(t.shopId, t.emailNormalized)],
);

/**
 * A repair visit (PDF: RepairVisit). The verified shop-scoped source key is
 * unique, so concurrent imports of one visit create one record (AT-07).
 */
export const repairVisit = pgTable(
  "repair_visit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customer.id),
    isTest: boolean("is_test").notNull(),
    sourceSystem: text("source_system").notNull(),
    sourceVisitKey: text("source_visit_key").notNull(),
    repairOrder: text("repair_order"),
    // Shop-local delivery date; never replaced by the import date (SR-10).
    deliveredOn: date("delivered_on", { mode: "string" }),
    deliveredOnRaw: text("delivered_on_raw"),
    importRowId: bigint("import_row_id", { mode: "number" }).references((): AnyPgColumn => importRow.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("repair_visit_identity_unique").on(t.shopId, t.sourceSystem, t.sourceVisitKey, t.isTest)],
);

/**
 * Read-only evidence of legacy survey sends and completions (PDF:
 * LegacySurveyLedger; SR-08). A sent-only visit is excluded too.
 */
export const legacySurveyLedger = pgTable(
  "legacy_survey_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    sourceSystem: text("source_system").notNull(),
    sourceVisitKey: text("source_visit_key").notNull(),
    invitedOn: date("invited_on", { mode: "string" }),
    completedOn: date("completed_on", { mode: "string" }),
    responseRef: text("response_ref"),
    importRowId: bigint("import_row_id", { mode: "number" }).references((): AnyPgColumn => importRow.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("legacy_survey_ledger_identity_unique").on(t.shopId, t.sourceSystem, t.sourceVisitKey)],
);

/** Shop-only opt-out (PDF: ShopOptOut; SR-25). Never cleared by a reimport. */
export const shopOptOut = pgTable(
  "shop_opt_out",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    emailNormalized: text("email_normalized").notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shop_opt_out_unique").on(t.shopId, t.emailNormalized)],
);

export const invitationStatus = pgEnum("invitation_status", ["eligible", "held", "excluded"]);

/**
 * Durable survey entitlement (PDF: Invitation). Pinned to one published
 * instrument version (SR-15). At most one invitation per repair visit; a
 * reimport reuses it (SR-07). Test invitations never contact customers (SR-03).
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
    // The shop's additional questions pinned when issued (SR-45); null when the shop has none.
    additionVersionId: uuid("addition_version_id").references(() => instrumentVersion.id),
    isTest: boolean("is_test").notNull(),
    // Null for PSG test links, which have no visit.
    visitId: uuid("visit_id").references((): AnyPgColumn => repairVisit.id),
    importRowId: bigint("import_row_id", { mode: "number" }).references((): AnyPgColumn => importRow.id),
    // Eligibility when created. Sending rechecks current eligibility (SR-11).
    status: invitationStatus("status").notNull().default("eligible"),
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitation_shop_idx").on(t.shopId),
    index("invitation_version_idx").on(t.instrumentVersionId),
    uniqueIndex("invitation_one_per_visit").on(t.visitId),
  ],
);

export const emailKind = pgEnum("email_kind", ["initial", "reminder", "renewal", "alert"]);
export const emailState = pgEnum("email_state", ["queued", "held", "sending", "accepted", "delivered", "bounced", "failed", "acceptance_unknown", "cancelled"]);

/**
 * A logical email to send (PDF: EmailIntent). One initial and at most one
 * reminder per invitation, enforced by unique keys. The dispatcher claims
 * intents and rechecks mode, opt-out and submission at send time (SR-26).
 */
export const emailIntent = pgTable(
  "email_intent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Survey emails belong to an invitation; alert emails to an Approve & Send decision. Exactly one is set.
    invitationId: uuid("invitation_id").references(() => invitation.id),
    alertApprovalId: uuid("alert_approval_id").references((): AnyPgColumn => alertApproval.id),
    kind: emailKind("kind").notNull(),
    // e.g. invitation:{id}:initial. Never shown in respondent URLs.
    idempotencyKey: text("idempotency_key").notNull().unique(),
    recipient: text("recipient").notNull(),
    isTest: boolean("is_test").notNull(),
    state: emailState("state").notNull().default("queued"),
    // Not before this time (reminders are scheduled ahead; retries back off).
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    // Why a held or cancelled intent did not send, e.g. SHOP_PAUSED or SHOP_OPT_OUT.
    stateReason: text("state_reason"),
    // Claim lease: a worker owns a "sending" intent until this time. A lease that
    // expires mid-send means the provider call may have happened (acceptance unknown).
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    providerMessageId: text("provider_message_id"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("email_intent_one_initial_or_reminder").on(t.invitationId, t.kind).where(sql`${t.kind} IN ('initial', 'reminder')`),
    index("email_intent_state_idx").on(t.state),
    index("email_intent_due_idx").on(t.dueAt).where(sql`${t.state} = 'queued'`),
    index("email_intent_provider_idx").on(t.providerMessageId),
    check("email_intent_one_owner", sql`(${t.invitationId} IS NULL) <> (${t.alertApprovalId} IS NULL)`),
  ],
);

/**
 * Provider delivery events (PDF: EmailReceipt), deduplicated by the
 * provider's event id so replayed webhooks change nothing (SR-23).
 */
export const emailEvent = pgTable(
  "email_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emailIntentId: uuid("email_intent_id").references(() => emailIntent.id),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // Only non-identifying fields are kept (no recipient address).
    detail: jsonb("detail"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("email_event_provider_unique").on(t.provider, t.providerEventId), index("email_event_intent_idx").on(t.emailIntentId)],
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
export const matchStatus = pgEnum("match_status", ["shop_unconfirmed", "visit_unmatched", "matched", "duplicate_review"]);

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
    // The shop's additional questions this response answered (SR-45); locked once submitted.
    additionVersionId: uuid("addition_version_id").references(() => instrumentVersion.id),
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
    // The repair visit this response is for, once known (PDF: Match).
    visitId: uuid("visit_id").references((): AnyPgColumn => repairVisit.id),
    matchStatus: matchStatus("match_status").notNull().default("matched"),
    // The one counted response for its visit (SR-19). Unmatched, duplicate and
    // draft responses are never canonical, so they never enter aggregates (SR-28).
    canonical: boolean("canonical").notNull().default(false),
    // How a non-canonical duplicate was settled: kept_original, promoted_other, legacy_reference.
    duplicateDisposition: text("duplicate_disposition"),
    // Paper: the date the paper form was received (SR-18).
    receivedOn: date("received_on", { mode: "string" }),
    enteredBy: text("entered_by").references(() => user.id),
    // Public form: what the respondent told us so PSG can find the visit (SR-13). Never shown to respondents.
    respondentContext: jsonb("respondent_context"),
    // Optimistic concurrency for PSG matching and duplicate decisions.
    matchRevision: integer("match_revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One online response per invitation; later paper/public duplicates are reviewed separately (SR-19).
    uniqueIndex("survey_response_one_online_per_invitation").on(t.invitationId).where(sql`${t.source} = 'online'`),
    // At most one counted response per visit, even under concurrent submits (AT-19).
    uniqueIndex("survey_response_one_canonical_per_visit").on(t.visitId).where(sql`${t.canonical}`),
    // A submit key is used once per source, so a concurrent retry can never save twice (PDF 05).
    uniqueIndex("survey_response_submit_key_unique").on(t.source, t.submitRequestKey).where(sql`${t.submitRequestKey} IS NOT NULL`),
    index("survey_response_shop_submitted_idx").on(t.shopId, t.submittedAt.desc()),
    index("survey_response_match_idx").on(t.matchStatus).where(sql`${t.matchStatus} <> 'matched'`),
    check("survey_response_submitted_complete", sql`${t.status} = 'draft' OR (${t.submittedAt} IS NOT NULL AND ${t.submitPayloadHash} IS NOT NULL)`),
    check("survey_response_canonical_is_matched", sql`NOT ${t.canonical} OR (${t.status} = 'submitted' AND ${t.matchStatus} = 'matched')`),
  ],
);

/**
 * Append-only record of PSG matching and duplicate decisions (PDF:
 * MatchDecision). Shop and visit association are recorded separately (AT-29).
 */
export const matchDecision = pgTable(
  "match_decision",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => surveyResponse.id),
    kind: text("kind").notNull(),
    shopId: uuid("shop_id").references(() => shop.id),
    visitId: uuid("visit_id").references(() => repairVisit.id),
    otherResponseId: uuid("other_response_id").references((): AnyPgColumn => surveyResponse.id),
    evidence: text("evidence"),
    actorUserId: text("actor_user_id").references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("match_decision_response_idx").on(t.responseId)],
);

/**
 * Evidence-backed shop suggestions for responses without confirmed shop
 * context (SR-29). PSG-only until confirmed; never auto-assigned.
 */
/**
 * Responses collected before this system (PDF: historical Supabase data;
 * SR-30). Read-only once loaded. Measures keep their own key and scale, so
 * unlike scales are shown side by side and never averaged together.
 */
export const historicalResponse = pgTable(
  "historical_response",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    sourceSystem: text("source_system").notNull(),
    sourceRef: text("source_ref").notNull(),
    respondedOn: date("responded_on", { mode: "string" }).notNull(),
    // { measureKey: { value: number | null, scale: "0-10" } }; null is missing, never zero.
    measures: jsonb("measures").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("historical_response_source_unique").on(t.sourceSystem, t.sourceRef), index("historical_response_shop_idx").on(t.shopId, t.respondedOn)],
);

/**
 * A follow-up case from the legacy system (SR-46). Imported as it stood
 * there; one row per legacy case, so repeated imports never duplicate it
 * (AT-46). A case closed in the legacy system is reference only. An open one
 * moves to Hub follow-up only by an explicit PSG handoff, after which the
 * legacy fields no longer change and Hub alone follows it up.
 */
export const legacyCase = pgTable(
  "legacy_case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    sourceSystem: text("source_system").notNull(),
    sourceRef: text("source_ref").notNull(),
    // As recorded in the legacy system at the last import.
    legacyStatus: text("legacy_status").notNull(),
    openedOn: date("opened_on", { mode: "string" }),
    summary: text("summary"),
    legacyOwner: text("legacy_owner"),
    visitKey: text("visit_key"),
    customerName: text("customer_name"),
    // Links to the read-only historical answers, when known (historical_response.source_ref).
    responseRef: text("response_ref"),
    legacyNotes: text("legacy_notes"),
    importRowId: bigint("import_row_id", { mode: "number" }).references((): AnyPgColumn => importRow.id),
    // Handoff: who took ownership in Hub, when, and what they confirmed.
    handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
    handedOffBy: text("handed_off_by").references(() => user.id),
    handoffNote: text("handoff_note"),
    resolutionOutcome: text("resolution_outcome"),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("legacy_case_identity_unique").on(t.shopId, t.sourceSystem, t.sourceRef),
    index("legacy_case_shop_idx").on(t.shopId),
    check("legacy_case_status", sql`${t.legacyStatus} IN ('open', 'closed')`),
    // Only a case still open in the legacy system can be handed off (closed ones are reference only).
    check("legacy_case_handoff_open_only", sql`${t.handedOffAt} IS NULL OR (${t.legacyStatus} = 'open' AND ${t.handedOffBy} IS NOT NULL AND ${t.handoffNote} IS NOT NULL)`),
    check("legacy_case_resolved_after_handoff", sql`${t.resolvedAt} IS NULL OR (${t.handedOffAt} IS NOT NULL AND ${t.resolutionOutcome} IS NOT NULL)`),
  ],
);

/** PSG follow-up notes on a legacy case after handoff. Append-only. */
export const legacyCaseNote = pgTable(
  "legacy_case_note",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => legacyCase.id),
    authorUserId: text("author_user_id").references(() => user.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("legacy_case_note_case_idx").on(t.caseId)],
);

export const alertStatus = pgEnum("alert_status", ["pending_review", "approved", "dismissed"]);
export const followUpStatus = pgEnum("follow_up_status", ["none", "open", "closure_requested", "resolved"]);

/**
 * PSG review of negative feedback (PDF: Alert/Case; SR-32..SR-34). One case
 * per response. No shop email exists until PSG approves; the shop still sees
 * the result at once (SR-27). Review, delivery and resolution are separate
 * states, never one status (PDF 03 "Parallel states").
 */
export const alertCase = pgTable(
  "alert_case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .unique()
      .references(() => surveyResponse.id),
    // Null until the response's shop is confirmed; outreach needs a confirmed shop.
    shopId: uuid("shop_id").references(() => shop.id),
    isTest: boolean("is_test").notNull(),
    // Fired alerts of the response revision this case reflects: [{ id, label, precedence }].
    alerts: jsonb("alerts").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    status: alertStatus("status").notNull().default("pending_review"),
    // Set when a correction changes the alerts after approval: PSG must look again; nothing resends by itself.
    outcomeChangedAt: timestamp("outcome_changed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    followUp: followUpStatus("follow_up").notNull().default("none"),
    closureRequestedBy: text("closure_requested_by").references(() => user.id),
    closureRequestedAt: timestamp("closure_requested_at", { withTimezone: true }),
    resolutionOutcome: text("resolution_outcome"),
    resolvedBy: text("resolved_by").references(() => user.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("alert_case_status_idx").on(t.status, t.createdAt),
    index("alert_case_shop_idx").on(t.shopId),
    check("alert_case_resolved_complete", sql`${t.followUp} <> 'resolved' OR (${t.resolvedAt} IS NOT NULL AND ${t.resolutionOutcome} IS NOT NULL)`),
  ],
);

/**
 * One Approve & Send decision (SR-33): who approved, and the exact recipients
 * for this alert, kept apart from the shop's saved list and from delivery.
 */
export const alertApproval = pgTable(
  "alert_approval",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => alertCase.id),
    approvalNumber: integer("approval_number").notNull(),
    recipients: text("recipients").array().notNull(),
    // The shop's saved list at approval time, to show what was adjusted for this alert.
    savedRecipients: text("saved_recipients").array().notNull(),
    sourceRevision: integer("source_revision").notNull(),
    note: text("note"),
    approvedBy: text("approved_by").references(() => user.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("alert_approval_number_unique").on(t.caseId, t.approvalNumber)],
);

/** Case history notes (PDF: CaseNote). Append-only; internal notes are never shown to shops (P-07). */
export const caseNote = pgTable(
  "case_note",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => alertCase.id),
    authorUserId: text("author_user_id").references(() => user.id),
    authorKind: text("author_kind").notNull(),
    visibility: text("visibility").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("case_note_case_idx").on(t.caseId), check("case_note_visibility", sql`${t.visibility} IN ('shop', 'internal')`)],
);

/**
 * A required routine-mail suppression change for manual application in
 * FileMaker until the bridge exists (PDF: SuppressionAction; SR-36).
 * Creating it is not applying it: only an operator acknowledgment is.
 */
export const suppressionAction = pgTable(
  "suppression_action",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => surveyResponse.id),
    ruleId: text("rule_id").notNull(),
    ruleLabel: text("rule_label").notNull(),
    // apply = start suppressing routine mail; remove = a later reversal, a separate required action (AT-36).
    desired: text("desired").notNull(),
    sourceRevision: integer("source_revision").notNull(),
    isTest: boolean("is_test").notNull(),
    status: text("status").notNull().default("outstanding"),
    acknowledgedBy: text("acknowledged_by").references(() => user.id),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    result: text("result"),
    evidence: text("evidence"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("suppression_action_status_idx").on(t.status, t.createdAt),
    check("suppression_action_desired", sql`${t.desired} IN ('apply', 'remove')`),
    check("suppression_action_status", sql`${t.status} IN ('outstanding', 'acknowledged')`),
    check("suppression_action_ack_complete", sql`${t.status} = 'outstanding' OR (${t.acknowledgedAt} IS NOT NULL AND ${t.result} IS NOT NULL)`),
  ],
);

/**
 * PSG's recorded launch checks for one shop (SR-37; PDF 09 activation
 * manifest). Checks that data can prove (version, cutoff, recipients, legacy
 * coverage) are computed live and never stored here. Confirming and
 * withdrawing are audited on the shop.
 */
export const shopReadiness = pgTable(
  "shop_readiness",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    item: text("item").notNull(),
    confirmedBy: text("confirmed_by")
      .notNull()
      .references(() => user.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.shopId, t.item] }),
    check("shop_readiness_item", sql`${t.item} IN ('mapping', 'branding', 'history', 'opt_outs', 'internal_test', 'acceptance')`),
  ],
);

/**
 * FileMaker bridge outbox (SR-41, SR-43): one event per version of a Hub
 * record that FileMaker needs. Unique per version, so replays never
 * duplicate; confirmed only after a read-back matches.
 */
export const bridgeEvent = pgTable(
  "bridge_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    // Increases with every change of the Hub record, so older versions never overwrite newer ones.
    entityVersion: integer("entity_version").notNull(),
    shopId: uuid("shop_id").references(() => shop.id),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    // PSG reviewed a FileMaker-side change and chose to put Hub's version back.
    overwriteApprovedBy: text("overwrite_approved_by").references(() => user.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bridge_event_version_unique").on(t.entityType, t.entityId, t.entityVersion),
    index("bridge_event_due_idx").on(t.nextAttemptAt).where(sql`${t.state} IN ('pending', 'retrying')`),
    index("bridge_event_state_idx").on(t.state),
    check("bridge_event_entity_type", sql`${t.entityType} IN ('response', 'case', 'suppression')`),
    check("bridge_event_state", sql`${t.state} IN ('pending', 'retrying', 'failed', 'conflict', 'confirmed', 'superseded')`),
    check("bridge_event_confirmed", sql`(${t.state} = 'confirmed') = (${t.confirmedAt} IS NOT NULL)`),
  ],
);

/** The one FileMaker record for each Hub record, and what Hub last confirmed there (AT-41, AT-43). */
export const bridgeMapping = pgTable(
  "bridge_mapping",
  {
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    confirmedVersion: integer("confirmed_version").notNull(),
    confirmedHash: text("confirmed_hash").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.entityType, t.entityId] }), unique("bridge_mapping_external_unique").on(t.externalId)],
);

/** PSG-recorded checks that must all hold before the bridge writes (SR-42, G-09). */
export const bridgeGate = pgTable(
  "bridge_gate",
  {
    item: text("item").primaryKey(),
    confirmedBy: text("confirmed_by")
      .notNull()
      .references(() => user.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note").notNull(),
  },
  (t) => [check("bridge_gate_item", sql`${t.item} IN ('field_map', 'alert_exclusion', 'sandbox_test', 'writes_enabled')`)],
);

/**
 * Everything in FileMaker that still relies on the bridge (SR-47): a report,
 * a mail run, a follow-up screen. Each must be replaced or retired before the
 * bridge can be.
 */
export const bridgeDependency = pgTable(
  "bridge_dependency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    // What it uses: survey results, follow-up status, suppression decisions, reporting.
    uses: text("uses").notNull(),
    status: text("status").notNull().default("in_use"),
    // What took its place, or why it is no longer needed.
    outcome: text("outcome"),
    updatedBy: text("updated_by").references(() => user.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bridge_dependency_status", sql`${t.status} IN ('in_use', 'replaced', 'retired')`),
    check("bridge_dependency_outcome", sql`${t.status} = 'in_use' OR ${t.outcome} IS NOT NULL`),
  ],
);

/** Signed record that the bridge was retired, with the dependencies as they stood (AT-47). Append-only. */
export const bridgeRetirement = pgTable("bridge_retirement", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  signedBy: text("signed_by")
    .notNull()
    .references(() => user.id),
  fileMakerOwner: text("file_maker_owner").notNull(),
  note: text("note").notNull(),
  dependencies: jsonb("dependencies").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Who owns one operator-queue item, and PSG review of worker failures
 * (SR-38). Items themselves live in their own tables (imports, emails,
 * responses, suppression); this only adds accountability. Changes are
 * audited on the item's own subject, so its history shows them.
 */
export const operatorItem = pgTable(
  "operator_item",
  {
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    ownerUserId: text("owner_user_id").references(() => user.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    assignedBy: text("assigned_by").references(() => user.id),
    // Worker failures and import rows only: a person looked at the problem and recorded what they did.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => user.id),
    reviewNote: text("review_note"),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.subjectType, t.subjectId] }),
    index("operator_item_owner_idx").on(t.ownerUserId).where(sql`${t.ownerUserId} is not null`),
    check("operator_item_subject_type", sql`${t.subjectType} IN ('invitation', 'email_intent', 'survey_response', 'suppression_action', 'worker_job', 'worker', 'import_row')`),
    check("operator_item_review_complete", sql`${t.reviewedAt} IS NULL OR (${t.reviewedBy} IS NOT NULL AND ${t.reviewNote} IS NOT NULL)`),
  ],
);

export const shopSuggestion = pgTable(
  "shop_suggestion",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => surveyResponse.id),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shop.id),
    // Where the hint came from, e.g. "Legacy company name 'Joe's Body Shop' (FileMaker id 1042)".
    evidence: text("evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("shop_suggestion_unique").on(t.responseId, t.shopId)],
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

/**
 * Operations notices sent to PSG (PDF 09: queue-health alerts within 15
 * minutes and a daily reconciliation). One row per problem or report key, so
 * two workers never send the same notice twice and an ongoing problem is
 * repeated only on a schedule, not every check.
 */
export const opsNotice = pgTable("ops_notice", {
  key: text("key").primaryKey(),
  open: boolean("open").notNull().default(true),
  detail: text("detail").notNull(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
