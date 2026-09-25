"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { isAccessError } from "@/modules/access/errors";
import type { DefinitionIssue } from "@/modules/instruments/definition";
import * as instruments from "@/modules/instruments/instruments";
import { DefinitionInvalidError, InstrumentConflictError, InstrumentNotFoundError } from "@/modules/instruments/store";
import { instrumentInputSchema } from "@/modules/instruments/validation";
import { ResponseConflictError } from "@/modules/responses/store";
import { createTestLink } from "@/modules/responses/test-links";

export type ActionResult<T = object> =
  | ({ ok: true } & T)
  | { ok: false; kind: "conflict" | "invalid" | "forbidden" | "not_found"; message: string; issues?: DefinitionIssue[] };

/** Map known domain errors to a safe result; anything else is a real failure. */
function failure(error: unknown): ActionResult<never> {
  if (error instanceof DefinitionInvalidError) return { ok: false, kind: "invalid", message: error.message, issues: error.issues };
  if (error instanceof InstrumentConflictError) return { ok: false, kind: "conflict", message: error.message };
  if (error instanceof InstrumentNotFoundError) return { ok: false, kind: "not_found", message: "This survey version no longer exists." };
  if (isAccessError(error)) return { ok: false, kind: "forbidden", message: "You do not have permission to change surveys." };
  throw error;
}

function refresh(instrumentId: string) {
  revalidatePath("/psg/instruments");
  revalidatePath(`/psg/instruments/${instrumentId}`);
}

export async function saveDraftAction(input: {
  versionId: string;
  expectedRevision: number;
  definition: unknown;
  sourceNote: string | null;
}): Promise<ActionResult<{ revision: number; savedAt: string }>> {
  try {
    const saved = await instruments.saveDraft(input.versionId, input.expectedRevision, input.definition, input.sourceNote);
    refresh(saved.instrumentId);
    return { ok: true, revision: saved.revision, savedAt: saved.updatedAt.toISOString() };
  } catch (error) {
    return failure(error);
  }
}

export async function publishAction(input: {
  versionId: string;
  expectedRevision: number;
  isTest: boolean;
  sourceNote: string | null;
}): Promise<ActionResult<{ instrumentId: string; version: number }>> {
  try {
    const published = await instruments.publishVersion(input.versionId, input.expectedRevision, { isTest: input.isTest, sourceNote: input.sourceNote });
    refresh(published.instrumentId);
    return { ok: true, instrumentId: published.instrumentId, version: published.version };
  } catch (error) {
    return failure(error);
  }
}

export async function discardDraftAction(input: { versionId: string; expectedRevision: number }): Promise<ActionResult<{ instrumentId: string }>> {
  try {
    const { instrumentId } = await instruments.discardDraft(input.versionId, input.expectedRevision);
    refresh(instrumentId);
    return { ok: true, instrumentId };
  } catch (error) {
    return failure(error);
  }
}

export async function createDraftFromAction(versionId: string): Promise<ActionResult> {
  let instrumentId: string;
  try {
    const draft = await instruments.createDraftFrom(versionId);
    instrumentId = draft.instrumentId;
    refresh(instrumentId);
  } catch (error) {
    return failure(error);
  }
  redirect(`/psg/instruments/${instrumentId}/edit`);
}

export interface InstrumentFormState {
  ok: boolean;
  message?: string;
  fieldErrors?: Partial<Record<"key" | "name" | "description", string>>;
  values?: { key: string; name: string; description: string };
}

function readInstrumentForm(formData: FormData) {
  const values = {
    key: String(formData.get("key") ?? ""),
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
  };
  const parsed = instrumentInputSchema.safeParse({ ...values, description: values.description.trim() || undefined });
  if (parsed.success) return { values, data: parsed.data, fieldErrors: null };
  const fieldErrors: InstrumentFormState["fieldErrors"] = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof NonNullable<InstrumentFormState["fieldErrors"]>;
    fieldErrors[key] ??= issue.message;
  }
  return { values, data: null, fieldErrors };
}

/** New empty survey, or a copy of `fromVersionId` when the form carries one (SR-44 duplication). */
export async function createInstrumentAction(_prev: InstrumentFormState, formData: FormData): Promise<InstrumentFormState> {
  const { values, data, fieldErrors } = readInstrumentForm(formData);
  if (!data) return { ok: false, fieldErrors: fieldErrors ?? {}, values };

  const fromVersionId = String(formData.get("fromVersionId") ?? "");
  let instrumentId: string;
  try {
    const created = fromVersionId ? await instruments.duplicateInstrument(fromVersionId, data) : await instruments.createInstrument(data);
    instrumentId = created.instrument.id;
  } catch (error) {
    const result = failure(error);
    if (!result.ok && result.kind === "conflict") return { ok: false, fieldErrors: { key: result.message }, values };
    return { ok: false, message: result.ok ? undefined : result.message, values };
  }
  revalidatePath("/psg/instruments");
  redirect(`/psg/instruments/${instrumentId}/edit`);
}

/**
 * Issue a TEST survey link for internal testing (SR-03, SR-37). The link is
 * shown once: only its hash is stored, so it cannot be displayed again.
 */
export async function createTestLinkAction(input: {
  shopId: string;
  instrumentVersionId: string;
  lifetimeDays: number;
}): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  try {
    const { token, expiresAt } = await createTestLink(input);
    revalidatePath("/psg/instruments");
    return { ok: true, url: `${env().APP_URL.replace(/\/$/, "")}/survey/${token}`, expiresAt: expiresAt.toISOString() };
  } catch (error) {
    if (error instanceof ResponseConflictError) return { ok: false, kind: "invalid", message: error.message };
    return failure(error);
  }
}
