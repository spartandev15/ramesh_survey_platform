import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { questionOptions } from "@/modules/instruments/builder-ops";
import { emptyDefinition, parseDefinition } from "@/modules/instruments/definition";
import { allQuestions } from "@/modules/instruments/questions";
import { getInstrument } from "@/modules/instruments/instruments";
import { InstrumentNotFoundError } from "@/modules/instruments/store";
import { Builder } from "./builder";

export const metadata: Metadata = { title: "Edit survey" };

export default async function EditInstrumentPage({ params }: PageProps<"/psg/instruments/[instrumentId]/edit">) {
  // Publishing is PSG admin work (SR-15); other staff get a plain 404.
  await pageRequireCapability("instrument.manage");
  const { instrumentId } = await params;

  const found = await getInstrument(instrumentId).catch((error: unknown) => {
    if (error instanceof InstrumentNotFoundError) return null;
    throw error;
  });
  if (!found) notFound();

  const draft = found.versions.find((v) => v.status === "draft");
  if (!draft) redirect(`/psg/instruments/${instrumentId}`);

  const parsed = parseDefinition(draft.definition);
  const basedOn = draft.basedOnVersionId ? found.versions.find((v) => v.id === draft.basedOnVersionId) : undefined;
  const basedOnDefinition = basedOn ? parseDefinition(basedOn.definition) : null;

  // Questions (and their options) carried from the published version keep their IDs,
  // so reports can compare versions by stable question ID (SR-15, SR-45).
  const lockedQuestions = basedOn?.status === "published" && basedOnDefinition?.ok ? allQuestions(basedOnDefinition.definition) : [];
  const lockedOptionIds = Object.fromEntries(
    lockedQuestions.map((q) => [q.id, [...questionOptions(q).map((o) => o.id), ...(q.type === "matrix" ? q.rows.map((r) => r.id) : [])]]),
  );

  return (
    <div className="max-w-7xl">
      {!parsed.ok && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          The saved draft could not be read ({parsed.issues[0]?.message}). The editor starts from an empty survey; saving will replace the stored draft.
        </p>
      )}
      <Builder
        instrumentId={found.instrument.id}
        instrumentName={found.instrument.name}
        versionId={draft.id}
        versionNumber={draft.version}
        basedOnVersion={basedOn?.version ?? null}
        initialRevision={draft.revision}
        initialSourceNote={draft.sourceNote}
        initialDefinition={parsed.ok ? parsed.definition : emptyDefinition()}
        lockedQuestionIds={lockedQuestions.map((q) => q.id)}
        lockedOptionIds={lockedOptionIds}
        isAddition={found.instrument.shopId !== null}
      />
    </div>
  );
}
