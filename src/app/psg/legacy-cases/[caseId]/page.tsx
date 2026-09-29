import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { RESOLUTION_OUTCOMES } from "@/modules/cases/store";
import { getLegacyCase } from "@/modules/legacy-cases/legacy-cases";
import { HandoffForm, NoteForm, ResolveForm } from "./panels";

export const metadata: Metadata = { title: "Legacy case" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

/** One legacy case: what the legacy system said (read-only), the handoff, and Hub follow-up (SR-46). */
export default async function LegacyCasePage({ params }: PageProps<"/psg/legacy-cases/[caseId]">) {
  const current = await pageRequireCapability("psg.workspace");
  const canResolve = hasCapability(current.principal, "case.resolve");
  const { caseId } = await params;
  const found = await getLegacyCase(caseId);
  if (!found) notFound();
  const { c, shopName, notes, historical } = found;
  const state = c.resolvedAt ? "Resolved in Hub" : c.handedOffAt ? "Followed up in Hub" : c.legacyStatus === "closed" ? "Closed in legacy: reference only" : "Still with the legacy owner";

  return (
    <div className="max-w-4xl">
      <Link href="/psg/legacy-cases" className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Legacy cases
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Legacy case {c.sourceRef}</h1>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">{state}</span>
      </div>

      <section aria-labelledby="legacy-record" className="mt-4 rounded-xl border border-gray-200 bg-white p-5">
        <h2 id="legacy-record" className="text-base font-semibold text-brand-navy-900">
          As recorded in the legacy system
        </h2>
        <p className="mt-1 text-xs text-gray-500">Read-only. {c.handedOffAt ? "Fixed at handoff; later imports do not change it." : "Updated by each import until Hub takes the case over."}</p>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {[
            ["Shop", shopName],
            ["Legacy status", c.legacyStatus === "open" ? "Open" : "Closed"],
            ["Opened", c.openedOn ?? "Unknown"],
            ["Legacy owner", c.legacyOwner ?? "Unknown"],
            ["Customer", c.customerName ?? "Not given"],
            ["Visit", c.visitKey ?? "Not given"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-gray-500">{label}</dt>
              <dd className="text-gray-900">{value}</dd>
            </div>
          ))}
          <div className="sm:col-span-2">
            <dt className="text-gray-500">Issue</dt>
            <dd className="whitespace-pre-line text-gray-900">{c.summary ?? "Not given"}</dd>
          </div>
          {c.legacyNotes && (
            <div className="sm:col-span-2">
              <dt className="text-gray-500">Notes in the legacy system</dt>
              <dd className="whitespace-pre-line text-gray-900">{c.legacyNotes}</dd>
            </div>
          )}
        </dl>
        {historical && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm">
            <p className="font-medium text-gray-900">Historical survey answers ({historical.respondedOn}, read-only)</p>
            <ul className="mt-1 text-gray-700">
              {Object.entries(historical.measures as Record<string, { value: number | null; scale: string }>).map(([key, m]) => (
                <li key={key}>
                  {key}: {m.value ?? "missing"} <span className="text-gray-500">(scale {m.scale})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="hub-followup" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 id="hub-followup" className="text-base font-semibold text-brand-navy-900">
          Hub follow-up
        </h2>
        {!c.handedOffAt && c.legacyStatus === "closed" && <p className="mt-2 text-sm text-gray-700">Nothing to follow up: this case was closed in the legacy system.</p>}
        {!c.handedOffAt && c.legacyStatus === "open" && (
          <div className="mt-3">
            <p className="mb-3 text-sm text-gray-700">This case is still followed up in the legacy system. Take it over only once its owner there has stopped.</p>
            {canResolve ? <HandoffForm caseId={c.id} revision={c.revision} legacyOwner={c.legacyOwner} /> : <p className="text-sm text-gray-500">A PSG reviewer or admin takes cases over.</p>}
          </div>
        )}
        {c.handedOffAt && (
          <div className="mt-3 flex flex-col gap-4">
            <p className="text-sm text-gray-800">
              Taken over by {found.handedOffByName ?? "PSG"}, {dateTime.format(c.handedOffAt)}: “{c.handoffNote}”
            </p>
            <ol className="flex flex-col gap-2 border-l-2 border-gray-200 pl-3 text-sm">
              {notes.length === 0 && <li className="text-gray-500">No notes yet.</li>}
              {notes.map((n) => (
                <li key={n.id}>
                  <span className="text-xs text-gray-500">
                    {dateTime.format(n.createdAt)} · {n.author ?? "PSG"}
                  </span>
                  <span className="block whitespace-pre-line text-gray-900">{n.body}</span>
                </li>
              ))}
            </ol>
            {c.resolvedAt ? (
              <p className="text-sm font-medium text-gray-900">
                Resolved by {found.resolvedByName ?? "PSG"}, {dateTime.format(c.resolvedAt)}: {RESOLUTION_OUTCOMES[c.resolutionOutcome as keyof typeof RESOLUTION_OUTCOMES] ?? c.resolutionOutcome}
              </p>
            ) : (
              <>
                <NoteForm caseId={c.id} />
                {canResolve && <ResolveForm caseId={c.id} revision={c.revision} outcomes={Object.entries(RESOLUTION_OUTCOMES)} />}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
