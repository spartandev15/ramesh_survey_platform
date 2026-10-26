import { CheckCircle2, FileText, FolderClosed, Info, Lightbulb, Search, Send, Upload, UserRound, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveForm } from "@/components/live-form";
import { Pagination } from "@/components/pagination";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listLegacyCases } from "@/modules/legacy-cases/legacy-cases";
import { LEGACY_VIEW_LABELS, LEGACY_VIEWS, type LegacyView } from "@/modules/legacy-cases/store";
import { ActionsHeader, RowActions } from "@/components/row-actions";

export const metadata: Metadata = { title: "Legacy cases" };

const HELP: Record<LegacyView, string> = {
  with_legacy: "Open in the legacy system and still followed up there. Take one over only after its legacy owner stops, so the customer is never contacted by both.",
  in_hub: "Taken over from the legacy system: Hub alone follows these up now.",
  resolved: "Resolved in Hub, with the outcome PSG confirmed.",
  reference: "Already closed in the legacy system. Kept for reference; nothing to follow up.",
};
const TILES: Record<LegacyView, { icon: LucideIcon; tone: string }> = {
  with_legacy: { icon: UserRound, tone: "bg-violet-50 text-violet-600" },
  in_hub: { icon: Send, tone: "bg-blue-50 text-blue-600" },
  resolved: { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
  reference: { icon: FolderClosed, tone: "bg-amber-50 text-amber-600" },
};

/** Legacy unresolved cases moving into Hub follow-up (SR-46). Import them from Imports as "Legacy follow-up cases". */
export default async function LegacyCasesPage({ searchParams }: PageProps<"/psg/legacy-cases">) {
  await pageRequireCapability("psg.workspace");
  const query = await searchParams;
  const requested = query.view;
  const view = LEGACY_VIEWS.includes(requested as LegacyView) ? (requested as LegacyView) : "with_legacy";
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
  const { list, counts } = await listLegacyCases(view, pageNumber(query.page), q);
  const rows = list.items;
  const base = Object.fromEntries(Object.entries(query).filter(([k, v]) => typeof v === "string" && v && k !== "page")) as Record<string, string>;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Legacy cases</h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              Follow-up cases from the legacy system. Repeated imports update a case until Hub takes it over and never create a second one. Compare these counts with the legacy system before and after
              a handoff.
            </p>
          </div>
          <Link href="/psg/imports" className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700">
            <Upload aria-hidden="true" className="size-4" />
            Import cases
          </Link>
        </div>

        <nav aria-label="Legacy case states" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-1 border-b border-gray-200">
            {LEGACY_VIEWS.map((v) => (
              <Link
                key={v}
                href={`/psg/legacy-cases?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                aria-current={v === view ? "page" : undefined}
                className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${v === view ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
              >
                {LEGACY_VIEW_LABELS[v]} <span className="text-gray-500">({counts[v]})</span>
              </Link>
            ))}
          </div>
        </nav>
        <p className="flex items-start gap-2.5 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-950">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-indigo-600" />
          {HELP[view]}
        </p>

        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm lg:grid-cols-4">
          {LEGACY_VIEWS.map((v) => {
            const t = TILES[v];
            return (
              <div key={v} className="flex items-center gap-3">
                <span className={`rounded-full p-3 ${t.tone}`} aria-hidden="true">
                  <t.icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xl font-semibold tabular-nums text-brand-navy-900">{counts[v]}</p>
                  <p className="text-xs text-gray-500">{LEGACY_VIEW_LABELS[v]}</p>
                </div>
              </div>
            );
          })}
        </div>

        <section aria-labelledby="cases-heading" className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5">
            <h2 id="cases-heading" className="text-lg font-semibold text-brand-navy-900">
              Cases <span className="font-normal text-gray-500">({list.total})</span>
            </h2>
            <LiveForm label="Find cases" className="relative w-full sm:w-72">
              {Object.entries(base).map(([k, v]) => (k === "q" ? null : <input key={k} type="hidden" name={k} value={v} />))}
              <label htmlFor="legacy-search" className="sr-only">
                Search cases
              </label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
              <input
                id="legacy-search"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={100}
                autoComplete="off"
                placeholder="Search cases, shops, issues..."
                className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white"
              />
            </LiveForm>
          </div>
          <div tabIndex={0} className="relative overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 border-t border-gray-100">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Case</th>
                  <th scope="col" className="px-3 py-3 font-medium">Shop</th>
                  <th scope="col" className="px-3 py-3 font-medium">Issue</th>
                  <th scope="col" className="px-3 py-3 font-medium">Opened</th>
                  <th scope="col" className="px-3 py-3 font-medium">Legacy owner</th>
                  <ActionsHeader />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center">
                      <FileText aria-hidden="true" className="mx-auto mb-3 size-14 rounded-full bg-gray-100 p-3.5 text-gray-500" />
                      <p className="font-semibold text-brand-navy-900">{q ? "No cases match this search." : "No cases here."}</p>
                      <p className="text-sm text-gray-500">{q ? "Try another case ID, shop or name." : "There are no cases in this category."}</p>
                    </td>
                  </tr>
                )}
                {rows.map(({ c, shopName }) => (
                  <tr key={c.id} className="align-top hover:bg-gray-50/60">
                    <td className="px-5 py-3">
                      <Link href={`/psg/legacy-cases/${c.id}`} className="font-mono text-xs font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                        {c.sourceRef}
                      </Link>
                      {c.customerName && <span className="block text-xs text-gray-600">{c.customerName}</span>}
                    </td>
                    <td className="px-3 py-3 text-gray-800">{shopName}</td>
                    <td className="max-w-80 px-3 py-3 text-gray-800">{c.summary ?? <span className="text-gray-500">Not given</span>}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-gray-700">{c.openedOn ?? "Unknown"}</td>
                    <td className="px-3 py-3 text-gray-700">{c.legacyOwner ?? "Unknown"}</td>
                    <td className="px-4 py-3">
                      <RowActions actions={[{ kind: "view", label: "View", href: `/psg/legacy-cases/${c.id}` }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 pb-4">
            <Pagination {...list} path="/psg/legacy-cases" query={base} label="Legacy case pages" />
          </div>
        </section>
      </div>

      <aside aria-label="About legacy cases" className="h-fit rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-indigo-50 p-2.5 text-indigo-600" aria-hidden="true">
            <FileText className="size-5" />
          </span>
          <h2 className="text-base font-semibold text-brand-navy-900">About legacy cases</h2>
        </div>
        <p className="mt-3 text-sm text-gray-600">These are follow-up cases from the legacy system. Repeated imports update a case until Hub takes it over and never create a second one.</p>
        <div className="mt-5 border-t border-gray-100 pt-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-navy-900">
            <Lightbulb aria-hidden="true" className="size-4 text-indigo-600" />
            Tips
          </p>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-600">
            <li>Compare these counts with the legacy system before and after a handoff.</li>
            <li>Import cases from Imports as &quot;Legacy follow-up cases&quot;.</li>
            <li>Take one over only after its legacy owner stops, so the customer is never contacted by both.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
