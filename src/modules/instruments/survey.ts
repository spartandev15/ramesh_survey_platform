import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { instrument, instrumentVersion } from "@/db/schema";
import { combineDefinitions, parseDefinition, type InstrumentDefinition } from "./definition";

/**
 * The survey an invitation or response is pinned to: the shared core version
 * and, optionally, the shop's own questions (SR-15, SR-45). Scoring always
 * uses the core rules only; the addition only adds pages.
 */

export interface PinnedVersion {
  id: string;
  number: number;
  isTest: boolean;
  definitionHash: string;
  instrumentId: string;
  /** Set for a shop's own questions; null for the shared core. */
  shopId: string | null;
}

export interface LoadedSurvey {
  core: PinnedVersion;
  addition: PinnedVersion | null;
  /** Core pages, then the shop's pages; core scores, alerts and suppression. */
  definition: InstrumentDefinition;
  /** The shop's questions on their own, to label them apart in results. */
  additionDefinition: InstrumentDefinition | null;
}

export class UnpublishedSurveyError extends Error {
  constructor(readonly versionId: string) {
    super("This survey version is not published.");
    this.name = "UnpublishedSurveyError";
  }
}

export async function loadSurvey(tx: Tx, coreVersionId: string, additionVersionId: string | null): Promise<LoadedSurvey> {
  const ids = additionVersionId ? [coreVersionId, additionVersionId] : [coreVersionId];
  const rows = await tx
    .select({ version: instrumentVersion, shopId: instrument.shopId })
    .from(instrumentVersion)
    .innerJoin(instrument, eq(instrument.id, instrumentVersion.instrumentId))
    .where(inArray(instrumentVersion.id, ids));
  const read = (id: string) => {
    const row = rows.find((r) => r.version.id === id);
    if (!row || row.version.status !== "published" || !row.version.definitionHash) throw new UnpublishedSurveyError(id);
    const parsed = parseDefinition(row.version.definition);
    if (!parsed.ok) throw new Error(`Instrument version ${id} is unreadable`);
    const pinned: PinnedVersion = {
      id,
      number: row.version.version,
      isTest: row.version.isTest,
      definitionHash: row.version.definitionHash,
      instrumentId: row.version.instrumentId,
      shopId: row.shopId,
    };
    return { pinned, definition: parsed.definition };
  };
  const core = read(coreVersionId);
  const addition = additionVersionId ? read(additionVersionId) : null;
  return {
    core: core.pinned,
    addition: addition?.pinned ?? null,
    definition: combineDefinitions(core.definition, addition?.definition ?? null),
    additionDefinition: addition?.definition ?? null,
  };
}
