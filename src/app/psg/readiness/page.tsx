import type { Metadata } from "next";
import { Clock, Download, Info, MinusCircle, Rocket, Search, Settings, Store } from "lucide-react";
import Link from "next/link";
import { LiveForm } from "@/components/live-form";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { getManifest } from "@/modules/readiness/readiness";
import { ModeBadge } from "../shops/mode-badge";
import { Checklist } from "./checklist";
import { ActionsHeader, RowActions } from "@/components/row-actions";
import { Tile } from "@/components/ui";

export const metadata: Metadata = { title: "Launch readiness" };

/**
 * Activation manifest for every in-scope shop (SR-37, PDF 09). A shop that
 * fails a check is listed with what is missing, never hidden. Nothing on this
 * page switches a shop to Live or sends anything.
 */
export default async function ReadinessPage({ searchParams }: PageProps<"/psg/readiness">) {
  await pageRequireCapability("psg.workspace");
  const [query, { email, shops, testShops }] = await Promise.all([searchParams, getManifest()]);
  const q = (typeof query.q === "string" ? query.q : "").trim().toLowerCase().slice(0, 100);
  const found = q ? shops.filter((s) => s.name.toLowerCase().includes(q)) : shops;
  const list = pageOf(found, pageNumber(query.page), 10);
  const ready = shops.filter((s) => s.ready).length;
  const emailOk = email.every((c) => c.status === "pass");
  const base = Object.fromEntries(Object.entries(query).filter(([k, v]) => typeof v === "string" && v && k !== "page")) as Record<string, string>;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Launch readiness</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">
            Every shop in scope, with what is still missing before it can go Live. Checks from the shop&apos;s settings update by themselves; the others are confirmed by a PSG admin with a note. A
            shop&apos;s first switch to Live needs every check; it stays a deliberate step on the shop&apos;s page.
          </p>
        </div>
        {/* The whole manifest, every shop and check, to keep as launch evidence (WP-11). */}
        <a
          href="/psg/readiness/export"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-indigo-200 bg-white px-4 text-sm font-medium text-indigo-700 shadow-sm transition hover:bg-indigo-50"
        >
          <Download className="size-4" aria-hidden="true" />
          Export CSV
        </a>
      </div>
      <p className="text-base text-gray-900">
        <span className="font-semibold">
          {ready} of {shops.length}
        </span>{" "}
        shop{shops.length === 1 ? "" : "s"} ready to launch.
      </p>

      <div data-tour="tiles" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={Rocket} tone="bg-blue-50 text-blue-600" value={ready} label="Ready to launch" note={`of ${shops.length} shop${shops.length === 1 ? "" : "s"}`} />
        <Tile icon={Clock} tone="bg-amber-50 text-amber-600" value={shops.length - ready} label="Not ready" note="still missing items" />
        <Tile icon={MinusCircle} tone="bg-slate-100 text-slate-500" value={testShops.length} label="Not in scope" note="internal test shops" />
        <Tile icon={Store} tone="bg-violet-50 text-violet-600" value={shops.length + testShops.length} label="Total shops" note="in this workspace" />
      </div>

      <section aria-labelledby="email-heading" className={`rounded-2xl border bg-white p-5 shadow-sm ${emailOk ? "border-gray-200/80" : "border-rose-200"}`}>
        <div className="flex items-start gap-3">
          <span className={`rounded-xl p-2.5 ${emailOk ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`} aria-hidden="true">
            <Settings className="size-5" />
          </span>
          <div>
            <h2 id="email-heading" className="text-base font-semibold text-brand-navy-900">
              Email sending, shared by every shop
            </h2>
            <p className={`text-sm ${emailOk ? "text-gray-500" : "text-rose-700"}`}>{emailOk ? "Done: every shop can use it." : "No shop can be ready until this passes."}</p>
          </div>
        </div>
        <div className="mt-3 rounded-xl border border-gray-100 px-4">
          <Checklist shopId="" checks={email} canManage={false} />
        </div>
      </section>

      <section aria-labelledby="shops-heading" className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 p-5">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600" aria-hidden="true">
              <Store className="size-5" />
            </span>
            <div>
              <h2 id="shops-heading" className="text-base font-semibold text-brand-navy-900">
                Shop readiness
              </h2>
              <p className="text-sm text-gray-500">Each shop shows what is still missing before it can go Live.</p>
            </div>
          </div>
          <LiveForm label="Find a shop" className="relative w-full sm:w-72" spinnerInside>
            {Object.entries(base).map(([k, v]) => (k === "q" ? null : <input key={k} type="hidden" name={k} value={v} />))}
            <label htmlFor="readiness-search" className="sr-only">
              Search shops
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
            <input
              id="readiness-search"
              name="q"
              type="search"
              defaultValue={q}
              maxLength={100}
              autoComplete="off"
              placeholder="Search shops..."
              className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white"
            />
          </LiveForm>
        </div>
        <div tabIndex={0} className="relative overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 border-t border-gray-100">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Shop</th>
                <th scope="col" className="px-3 py-3 font-medium">Mode</th>
                <th scope="col" className="px-3 py-3 font-medium">Status</th>
                <th scope="col" className="px-3 py-3 font-medium">Still missing</th>
                <ActionsHeader />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.total === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-gray-500">
                    <Store aria-hidden="true" className="mx-auto mb-2 size-8 rounded-full bg-gray-100 p-1.5 text-gray-500" />
                    <p className="font-medium text-gray-800">{q ? "No shops match this search." : "No shops yet."}</p>
                    {!q && <p className="text-xs">Shops appear here once they are in scope.</p>}
                  </td>
                </tr>
              )}
              {list.items.map((s) => {
                const own = s.missing.filter((c) => !c.key.startsWith("email_"));
                return (
                  <tr key={s.shopId} className="align-top hover:bg-gray-50/60">
                    <td className="px-5 py-3">
                      <Link href={`/psg/shops/${s.shopId}#readiness`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                        {s.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <ModeBadge mode={s.mode} />
                    </td>
                    <td className="px-3 py-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.ready ? "bg-emerald-100 text-emerald-800" : "bg-rose-50 text-rose-700"}`}>{s.ready ? "Ready" : `${s.missing.length} missing`}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-700">
                      {own.length === 0 ? (
                        s.ready ? (
                          "Nothing"
                        ) : (
                          "Only the shared email setup"
                        )
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {own.map((c) => (
                            <span key={c.key} className="rounded-md bg-gray-100 px-1.5 py-0.5">
                              {c.label}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <RowActions actions={[{ kind: "edit", label: "Checklist", href: `/psg/shops/${s.shopId}#readiness` }]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 pb-4">
          <Pagination {...list} path="/psg/readiness" query={base} label="Readiness pages" />
        </div>
      </section>

      {testShops.length > 0 && (
        <p className="flex items-start gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm text-indigo-950">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-indigo-600" />
          <span>Not in scope (internal test shops, which never go Live and never count in reports): {testShops.map((t) => t.name).join(", ")}.</span>
        </p>
      )}
    </div>
  );
}
