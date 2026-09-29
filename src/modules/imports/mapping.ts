import { z } from "zod";
import { isIsoDate } from "@/modules/shops/settings-policy";

/**
 * Column mapping and row normalization for imports (SR-06, SR-09, SR-10).
 * The real shop document layout is not yet known (G-02), so PSG maps columns
 * per batch. Raw values are always kept; nothing unknown is silently replaced.
 */

export type ImportKind = "visits" | "legacy_ledger" | "legacy_cases";

export interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  synonyms: string[];
}

const VISIT_FIELDS: FieldSpec[] = [
  { key: "sourceVisitKey", label: "Visit ID (unique per repair visit)", required: true, synonyms: ["visit id", "visit key", "source visit key", "job id", "estimate id", "ro", "ro number", "ro #", "repair order", "repair order number"] },
  { key: "repairOrder", label: "Repair order number", required: false, synonyms: ["repair order", "repair order number", "ro", "ro number", "ro #"] },
  { key: "firstName", label: "First name", required: false, synonyms: ["first name", "firstname", "first", "customer first name"] },
  { key: "lastName", label: "Last name", required: false, synonyms: ["last name", "lastname", "last", "surname", "customer last name"] },
  { key: "email", label: "Email", required: false, synonyms: ["email", "e-mail", "email address", "customer email"] },
  { key: "phone", label: "Phone", required: false, synonyms: ["phone", "phone number", "mobile", "cell", "customer phone"] },
  { key: "deliveredOn", label: "Delivery date", required: false, synonyms: ["delivered", "delivered on", "delivery date", "date delivered", "delivered date"] },
];

const LEDGER_FIELDS: FieldSpec[] = [
  { key: "sourceVisitKey", label: "Visit ID (same as in visit imports)", required: true, synonyms: ["visit id", "visit key", "source visit key", "ro", "ro number", "repair order", "repair order number"] },
  { key: "invitedOn", label: "Survey sent date", required: false, synonyms: ["invited", "invited on", "sent", "sent on", "survey sent", "date sent"] },
  { key: "completedOn", label: "Survey completed date", required: false, synonyms: ["completed", "completed on", "survey completed", "date completed", "response date"] },
  { key: "responseRef", label: "Legacy response reference", required: false, synonyms: ["response id", "response ref", "legacy id", "record id"] },
];

/** Legacy follow-up cases (SR-46). The export layout is not known yet, so PSG maps the columns. */
const LEGACY_CASE_FIELDS: FieldSpec[] = [
  { key: "caseRef", label: "Legacy case ID (unique per case)", required: true, synonyms: ["case id", "case ref", "case number", "case", "ticket", "ticket id", "record id", "issue id"] },
  { key: "status", label: "Status in the legacy system (open or closed)", required: true, synonyms: ["status", "case status", "state"] },
  { key: "openedOn", label: "Opened on", required: false, synonyms: ["opened", "opened on", "created", "created on", "date opened", "date"] },
  { key: "summary", label: "What the issue is", required: false, synonyms: ["summary", "issue", "subject", "description", "problem", "complaint"] },
  { key: "legacyOwner", label: "Current owner in the legacy system", required: false, synonyms: ["owner", "assigned to", "assignee", "handled by"] },
  { key: "visitKey", label: "Visit ID", required: false, synonyms: ["visit id", "visit key", "ro", "ro number", "repair order", "repair order number"] },
  { key: "customerName", label: "Customer name", required: false, synonyms: ["customer", "customer name", "name"] },
  { key: "responseRef", label: "Legacy response reference", required: false, synonyms: ["response id", "response ref", "survey id"] },
  { key: "notes", label: "Notes so far", required: false, synonyms: ["notes", "comments", "history", "follow up", "follow-up"] },
];

export function fieldsFor(kind: ImportKind): FieldSpec[] {
  return kind === "visits" ? VISIT_FIELDS : kind === "legacy_ledger" ? LEDGER_FIELDS : LEGACY_CASE_FIELDS;
}

export type Mapping = Record<string, string>;

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, " ");

/** Suggest a column for each field by header name. PSG confirms before commit. */
export function guessMapping(headers: string[], kind: ImportKind): Mapping {
  const used = new Set<string>();
  const mapping: Mapping = {};
  for (const field of fieldsFor(kind)) {
    const match = headers.find((h) => !used.has(h) && field.synonyms.includes(normalizeHeader(h)));
    if (match) {
      mapping[field.key] = match;
      used.add(match);
    }
  }
  return mapping;
}

/** Problems that stop a commit: missing required fields or unknown/duplicate columns. */
export function mappingIssues(mapping: Mapping, headers: string[], kind: ImportKind): string[] {
  const issues: string[] = [];
  const fields = fieldsFor(kind);
  for (const field of fields) {
    if (field.required && !mapping[field.key]) issues.push(`Choose the column for "${field.label}".`);
  }
  for (const [key, header] of Object.entries(mapping)) {
    if (!fields.some((f) => f.key === key)) issues.push(`Unknown field "${key}".`);
    else if (header && !headers.includes(header)) issues.push(`Column "${header}" is not in the file.`);
  }
  const chosen = Object.entries(mapping)
    .filter(([key, h]) => h && key !== "repairOrder")
    .map(([, h]) => h);
  if (new Set(chosen).size !== chosen.length) issues.push("A column is used for more than one field.");
  return issues;
}

/**
 * Parse a date written as YYYY-MM-DD or US M/D/YYYY. Two-digit years and
 * other formats are not guessed: they come back invalid for PSG to fix.
 */
export function parseDate(raw: string): { value: string | null; invalid: boolean } {
  const text = raw.trim();
  if (text === "") return { value: null, invalid: false };
  if (isIsoDate(text)) return { value: text, invalid: false };
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) {
    const iso = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    if (isIsoDate(iso)) return { value: iso, invalid: false };
  }
  return { value: null, invalid: true };
}

/** Trim and lower-case only (PDF 04). Returns null for a missing or unusable address. */
export function normalizeEmail(raw: string | undefined): string | null {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return null;
  return z.email().safeParse(text).success ? text : null;
}

const cell = (raw: Record<string, string>, mapping: Mapping, key: string) => {
  const header = mapping[key];
  return header ? (raw[header] ?? "").trim() : "";
};

export interface NormalizedVisit {
  sourceVisitKey: string | null;
  repairOrder: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emailRaw: string | null;
  emailNormalized: string | null;
  phone: string | null;
  deliveredOn: string | null;
  deliveredOnRaw: string | null;
  deliveredOnInvalid: boolean;
}

export function normalizeVisitRow(raw: Record<string, string>, mapping: Mapping): NormalizedVisit {
  const orNull = (v: string) => (v === "" ? null : v);
  const emailRaw = orNull(cell(raw, mapping, "email"));
  const deliveredRaw = cell(raw, mapping, "deliveredOn");
  const delivered = parseDate(deliveredRaw);
  const emailNormalized = normalizeEmail(emailRaw ?? undefined);
  return {
    sourceVisitKey: orNull(cell(raw, mapping, "sourceVisitKey")),
    repairOrder: orNull(cell(raw, mapping, "repairOrder")),
    firstName: orNull(cell(raw, mapping, "firstName")),
    lastName: orNull(cell(raw, mapping, "lastName")),
    email: emailNormalized ? emailRaw : null,
    emailRaw,
    emailNormalized,
    phone: orNull(cell(raw, mapping, "phone")),
    deliveredOn: delivered.value,
    deliveredOnRaw: orNull(deliveredRaw),
    deliveredOnInvalid: delivered.invalid,
  };
}

export interface NormalizedLedgerRow {
  sourceVisitKey: string | null;
  invitedOn: string | null;
  completedOn: string | null;
  responseRef: string | null;
  invalidDates: boolean;
}

export interface NormalizedLegacyCase {
  caseRef: string | null;
  /** Null when the status is not clearly open or closed: it is never guessed. */
  status: "open" | "closed" | null;
  openedOn: string | null;
  invalidDate: boolean;
  summary: string | null;
  legacyOwner: string | null;
  visitKey: string | null;
  customerName: string | null;
  responseRef: string | null;
  notes: string | null;
}

const OPEN_STATUSES = new Set(["open", "unresolved", "pending", "in progress", "new", "active"]);
const CLOSED_STATUSES = new Set(["closed", "resolved", "done", "complete", "completed"]);

export function normalizeLegacyCaseRow(raw: Record<string, string>, mapping: Mapping): NormalizedLegacyCase {
  const text = (key: string, max: number) => cell(raw, mapping, key).slice(0, max) || null;
  const status = normalizeHeader(cell(raw, mapping, "status"));
  const opened = parseDate(cell(raw, mapping, "openedOn"));
  return {
    caseRef: text("caseRef", 200),
    status: OPEN_STATUSES.has(status) ? "open" : CLOSED_STATUSES.has(status) ? "closed" : null,
    openedOn: opened.value,
    invalidDate: opened.invalid,
    summary: text("summary", 2000),
    legacyOwner: text("legacyOwner", 200),
    visitKey: text("visitKey", 200),
    customerName: text("customerName", 200),
    responseRef: text("responseRef", 200),
    notes: text("notes", 5000),
  };
}

export function normalizeLedgerRow(raw: Record<string, string>, mapping: Mapping): NormalizedLedgerRow {
  const invited = parseDate(cell(raw, mapping, "invitedOn"));
  const completed = parseDate(cell(raw, mapping, "completedOn"));
  const key = cell(raw, mapping, "sourceVisitKey");
  const ref = cell(raw, mapping, "responseRef");
  return {
    sourceVisitKey: key || null,
    invitedOn: invited.value,
    completedOn: completed.value,
    responseRef: ref || null,
    invalidDates: invited.invalid || completed.invalid,
  };
}
