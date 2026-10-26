import { AlertCircle, AlertTriangle, BarChart3, CheckCircle2, ClipboardCheck, Clock, Database, RefreshCw, type LucideIcon } from "lucide-react";
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
const STATE_DOTS: Record<EventState, string> = { pending: "bg-gray-400", retrying: "bg-blue-500", failed: "bg-rose-500", conflict: "bg-amber-500", confirmed: "bg-emerald-500", superseded: "bg-slate-300" };
const card = "rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm";

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
  const remaining = GATES.filter((g) => !gates.has(g)).length;
  const on = status.readiness.enabled;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">FileMaker bridge</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          A temporary, one-way copy of the Hub records FileMaker still needs: survey responses, corrections, follow-up outcomes and suppression changes. Hub stays the owner. A record counts as
          confirmed only when FileMaker gives back exactly what Hub wrote. If FileMaker is down, Hub keeps working and the records wait here.
        </p>
      </div>

      {/* Status at a glance */}
      <div data-tour="tiles" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <div className="col-span-2 flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm md:col-span-1">
          <span className={`size-3 shrink-0 rounded-full ${on ? "bg-emerald-500" : "bg-gray-400"}`} aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-gray-700">Bridge status</p>
            <p className="text-xl font-semibold text-brand-navy-900">{on ? "Writing" : "Off"}</p>
            <p className="text-xs text-gray-500">{on ? "Writes to FileMaker are on" : "Writes to FileMaker are off"}</p>
          </div>
        </div>
        <Tile icon={Database} tone="bg-blue-50 text-blue-600" label="Pending records" value={String(status.counts.pending)} note="Waiting to send" />
        <Tile icon={RefreshCw} tone="bg-sky-50 text-sky-600" label="Retrying" value={String(status.counts.retrying)} note="Will try again by itself" />
        <Tile icon={AlertCircle} tone="bg-rose-50 text-rose-600" label="Failed" value={String(status.counts.failed + status.counts.conflict)} note="Need attention" />
        <Tile
          icon={Clock}
          tone="bg-indigo-50 text-indigo-600"
          label="Last confirmed write"
          value={status.lag.lastConfirmedAt ? dateTime.format(status.lag.lastConfirmedAt) : "–"}
          note={status.lag.oldestWaiting ? `Oldest waiting since ${dateTime.format(status.lag.oldestWaiting)}` : "Nothing waiting"}
          small
        />
      </div>

      <section aria-labelledby="bridge-state" className={`rounded-2xl border p-5 shadow-sm ${on ? "border-emerald-200 bg-emerald-50/50" : "border-amber-300 bg-amber-50/60"}`}>
        <div className="flex items-start gap-3">
          {on ? <CheckCircle2 aria-hidden="true" className="size-6 shrink-0 text-emerald-600" /> : <AlertTriangle aria-hidden="true" className="size-6 shrink-0 text-amber-500" />}
          <div className="min-w-0">
            <h2 id="bridge-state" className="text-base font-semibold text-brand-navy-900">
              Writes to FileMaker: {on ? "On" : "Off"}
            </h2>
            {!on && (
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-800">
                {status.readiness.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-gray-600">
              Last confirmed write: {status.lag.lastConfirmedAt ? dateTime.format(status.lag.lastConfirmedAt) : "never"}
              {status.lag.oldestWaiting && ` · oldest waiting since ${dateTime.format(status.lag.oldestWaiting)}`}. Routine-mail changes stay in the Suppression queue by hand until the bridge covers them.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="bridge-gates" className={card}>
        <SectionHead icon={ClipboardCheck} id="bridge-gates" title="Checks before any write" subtitle="Record each check with who confirmed it. Writes switch on only after all of them.">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${remaining === 0 ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>
            {remaining === 0 ? "All recorded" : `${remaining} item${remaining === 1 ? "" : "s"} remaining`}
          </span>
        </SectionHead>
        <ul className="mt-3 flex flex-col divide-y divide-gray-100 rounded-xl border border-gray-100">
          {GATES.map((g) => {
            const done = gates.get(g);
            return (
              <li key={g} className="px-4 py-3">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${done ? "bg-emerald-100 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{done ? "Done" : "Missing"}</span>
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

      <section aria-labelledby="bridge-counts" className={card}>
        <SectionHead icon={BarChart3} id="bridge-counts" title="Records by state">
          <span className="text-xs text-gray-500">Counts update by themselves.</span>
        </SectionHead>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {EVENT_STATES.map((s: EventState) => (
            <div key={s} className="flex items-start gap-2.5 rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <span className={`mt-1 size-2.5 shrink-0 rounded-full ${STATE_DOTS[s]}`} aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-xs text-gray-600">{STATE_LABELS[s]}</dt>
                <dd className="mt-0.5 text-xl font-semibold tabular-nums text-brand-navy-900">{status.counts[s]}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="bridge-retirement" className={card}>
        <SectionHead
          icon={Database}
          id="bridge-retirement"
          title="Retirement"
          subtitle="The bridge is retired only when every FileMaker report, mail run or screen that relies on it is replaced or no longer needed, and nothing is left waiting for someone to pick up (SR-47). Signing switches writes off; the records, mappings and history all stay."
        />
        <ul className="mt-3 flex flex-col divide-y divide-gray-100">
          {dependencies.total === 0 && <li className="py-2 text-sm text-gray-500">No dependencies listed yet.</li>}
          {dependencies.items.map(({ d, by }) => (
            <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
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

      <section aria-labelledby="bridge-problems" className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <div className="p-5 pb-0">
          <SectionHead icon={AlertTriangle} id="bridge-problems" title="Needs attention" tone="bg-amber-50 text-amber-600" />
        </div>
        <div tabIndex={0} className="relative mt-3 overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 border-t border-gray-100">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Record</th>
                <th scope="col" className="px-3 py-3 font-medium">State</th>
                <th scope="col" className="px-3 py-3 font-medium">Last attempt</th>
                {canSettle && <th scope="col" className="px-3 py-3 font-medium">Decision</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {status.problems.total === 0 && (
                <tr>
                  <td colSpan={canSettle ? 4 : 3} className="px-5 py-8 text-left text-gray-500 sm:text-center">
                    Nothing needs attention.
                  </td>
                </tr>
              )}
              {status.problems.items.map(({ event, shopName }) => (
                <tr key={event.id} className="align-top hover:bg-gray-50/60">
                  <td className="px-5 py-3">
                    {ENTITY_LABELS[event.entityType] ?? event.entityType} · version {event.entityVersion}
                    <span className="block text-xs text-gray-600">{shopName ?? "Shop not known"}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-medium text-gray-900">{STATE_LABELS[event.state as EventState] ?? event.state}</span>
                    {event.lastError && <span className="block max-w-80 break-words text-xs text-gray-600">{event.lastError}</span>}
                    <span className="block text-xs text-gray-500">
                      {event.attempts} attempt{event.attempts === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-gray-600">{dateTime.format(event.updatedAt)}</td>
                  {canSettle && (
                    <td className="px-3 py-3">
                      <ProblemControl eventId={event.id} state={event.state} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination {...status.problems} path="/psg/bridge" query={query} anchor="bridge-problems" label="Bridge problem pages" />
        </div>
      </section>
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, note, small = false }: { icon: LucideIcon; tone: string; label: string; value: string; note: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <span className={`rounded-full p-3 ${tone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-700">{label}</p>
        <p className={`font-semibold tabular-nums text-brand-navy-900 ${small ? "text-sm" : "text-xl"}`}>{value}</p>
        <p className="truncate text-xs text-gray-500">{note}</p>
      </div>
    </div>
  );
}

function SectionHead({ icon: Icon, id, title, subtitle, tone = "bg-indigo-50 text-indigo-600", children }: { icon: LucideIcon; id: string; title: string; subtitle?: string; tone?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`rounded-xl p-2.5 ${tone}`} aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-brand-navy-900">
            {title}
          </h2>
          {subtitle && <p className="max-w-3xl text-xs text-gray-600">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
