import type { Metadata } from "next";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { getBridgeStatus, getRetirementStatus } from "@/modules/bridge/bridge";
import { EVENT_STATES, GATE_LABELS, GATES, STATE_LABELS, type EventState } from "@/modules/bridge/policy";
import { DEPENDENCY_STATUS, type DependencyStatus as DependencyStatusKey } from "@/modules/bridge/retirement";
import { GateControl, ProblemControl } from "./controls";
import { AddDependency, DependencyStatus, SignRetirement } from "./retirement-controls";

export const metadata: Metadata = { title: "FileMaker bridge" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const ENTITY_LABELS: Record<string, string> = { response: "Survey response", case: "Follow-up case", suppression: "Suppression change" };

/**
 * The temporary FileMaker bridge (SR-41..SR-43): what it is waiting for, what
 * it has confirmed by read-back, and what needs a person. Hub stays the
 * owner: nothing here copies FileMaker data into Hub.
 */
export default async function BridgePage({ searchParams }: PageProps<"/psg/bridge">) {
  const current = await pageRequireCapability("psg.workspace");
  const canGate = hasCapability(current.principal, "shop.manage");
  const canSettle = hasCapability(current.principal, "operations.manage");
  const query = await searchParams;
  const [status, retirementStatus] = await Promise.all([getBridgeStatus(pageNumber(query.page)), getRetirementStatus()]);
  // Dependencies still in use first (they block retirement), then the newest.
  const dependencies = pageOf(
    [...retirementStatus.dependencies].sort((a, b) => Number(b.d.status === "in_use") - Number(a.d.status === "in_use") || b.d.createdAt.getTime() - a.d.createdAt.getTime()),
    pageNumber(query.dpage),
  );
  const gates = new Map(status.gates.map((g) => [g.item, g]));

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">FileMaker bridge</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        A temporary, one-way copy of the Hub records FileMaker still needs: survey responses, corrections, follow-up outcomes and suppression changes. Hub stays the owner. A record counts as
        confirmed only when FileMaker gives back exactly what Hub wrote. If FileMaker is down, Hub keeps working and the records wait here.
      </p>

      <section aria-labelledby="bridge-state" className={`mt-5 rounded-xl border bg-white p-4 ${status.readiness.enabled ? "border-gray-200" : "border-amber-300"}`}>
        <h2 id="bridge-state" className="text-sm font-semibold text-brand-navy-900">
          Writes to FileMaker: {status.readiness.enabled ? "On" : "Off"}
        </h2>
        {!status.readiness.enabled && (
          <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
            {status.readiness.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-gray-600">
          Last confirmed write: {status.lag.lastConfirmedAt ? dateTime.format(status.lag.lastConfirmedAt) : "never"}
          {status.lag.oldestWaiting && ` · oldest waiting since ${dateTime.format(status.lag.oldestWaiting)}`}. Routine-mail changes stay in the Suppression queue by hand until the bridge covers them.
        </p>
      </section>

      <section aria-labelledby="bridge-gates" className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="bridge-gates" className="text-sm font-semibold text-brand-navy-900">
          Checks before any write
        </h2>
        <ul className="mt-1 flex flex-col divide-y divide-gray-100">
          {GATES.map((g) => {
            const done = gates.get(g);
            return (
              <li key={g} className="py-2.5">
                <div className="flex flex-wrap items-start gap-2">
                  <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${done ? "bg-emerald-100 text-emerald-800" : "bg-brand-red/10 text-brand-red-dark"}`}>{done ? "Done" : "Missing"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">{GATE_LABELS[g].label}</p>
                    <p className="text-xs text-gray-600">{GATE_LABELS[g].help}</p>
                    {done && (
                      <p className="mt-0.5 break-words text-xs text-gray-700">
                        Recorded by {done.by}, {dateTime.format(done.confirmedAt)}: “{done.note}”
                      </p>
                    )}
                    {canGate && <GateControl item={g} label={GATE_LABELS[g].label} confirmed={Boolean(done)} />}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="bridge-counts" className="mt-5">
        <h2 id="bridge-counts" className="text-sm font-semibold text-brand-navy-900">
          Records by state
        </h2>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {EVENT_STATES.map((s: EventState) => (
            <div key={s} className="rounded-xl border border-gray-200 bg-white p-3">
              <dt className="text-xs text-gray-600">{STATE_LABELS[s]}</dt>
              <dd className="mt-1 text-xl font-semibold text-brand-navy-900">{status.counts[s]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="bridge-retirement" className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <h2 id="bridge-retirement" className="text-sm font-semibold text-brand-navy-900">
          Retirement
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-gray-600">
          The bridge is retired only when every FileMaker report, mail run or screen that relies on it is replaced or no longer needed, and nothing is left waiting for someone to pick
          up (SR-47). Signing switches writes off; the records, mappings and history all stay.
        </p>
        <ul className="mt-3 flex flex-col divide-y divide-gray-100">
          {dependencies.total === 0 && <li className="py-2 text-sm text-gray-500">No dependencies listed yet.</li>}
          {dependencies.items.map(({ d, by }) => (
            <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{d.name}</p>
                <p className="text-xs text-gray-600">Uses: {d.uses}</p>
                <p className="text-xs text-gray-700">
                  {DEPENDENCY_STATUS[d.status as DependencyStatusKey] ?? d.status}
                  {d.outcome ? `: ${d.outcome}` : ""}
                  {by ? ` · ${by}, ${dateTime.format(d.updatedAt)}` : ""}
                </p>
              </div>
              {canGate && <DependencyStatus id={d.id} name={d.name} status={d.status} statuses={Object.entries(DEPENDENCY_STATUS)} />}
            </li>
          ))}
        </ul>
        <Pagination {...dependencies} path="/psg/bridge" query={query} param="dpage" anchor="bridge-retirement" label="Dependency pages" />
        {canGate && (
          <div className="mt-3">
            <AddDependency />
          </div>
        )}
        <div className="mt-4 border-t border-gray-100 pt-3">
          {retirementStatus.blockers.length > 0 ? (
            <>
              <p className="text-sm font-medium text-gray-900">Not ready to retire yet</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
                {retirementStatus.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </>
          ) : (
            canGate && <SignRetirement />
          )}
        </div>
        {retirementStatus.signed.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2 border-t border-gray-100 pt-3 text-sm">
            {retirementStatus.signed.map(({ r, by }) => (
              <li key={r.id} className="text-gray-800">
                Retired by {by} with {r.fileMakerOwner}, {dateTime.format(r.signedAt)}: “{r.note}” ({(r.dependencies as unknown[]).length} dependencies recorded)
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bridge-problems" className="mt-5">
        <h2 id="bridge-problems" className="text-sm font-semibold text-brand-navy-900">
          Needs attention
        </h2>
        <div className="relative mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Record</th>
                <th scope="col" className="px-3 py-2 font-medium">State</th>
                <th scope="col" className="px-3 py-2 font-medium">Last attempt</th>
                {canSettle && <th scope="col" className="px-3 py-2 font-medium">Decision</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {status.problems.total === 0 && (
                <tr>
                  <td colSpan={canSettle ? 4 : 3} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                    Nothing needs attention.
                  </td>
                </tr>
              )}
              {status.problems.items.map(({ event, shopName }) => (
                <tr key={event.id} className="align-top">
                  <td className="px-3 py-2.5">
                    {ENTITY_LABELS[event.entityType] ?? event.entityType} · version {event.entityVersion}
                    <span className="block text-xs text-gray-600">{shopName ?? "Shop not known"}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-gray-900">{STATE_LABELS[event.state as EventState] ?? event.state}</span>
                    {event.lastError && <span className="block max-w-80 break-words text-xs text-gray-600">{event.lastError}</span>}
                    <span className="block text-xs text-gray-500">
                      {event.attempts} attempt{event.attempts === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-gray-600">{dateTime.format(event.updatedAt)}</td>
                  {canSettle && (
                    <td className="px-3 py-2.5">
                      <ProblemControl eventId={event.id} state={event.state} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...status.problems} path="/psg/bridge" query={query} anchor="bridge-problems" label="Bridge problem pages" />
      </section>
    </div>
  );
}
