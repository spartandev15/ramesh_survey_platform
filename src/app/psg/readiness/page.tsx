import type { Metadata } from "next";
import { Download } from "lucide-react";
import Link from "next/link";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { getManifest } from "@/modules/readiness/readiness";
import { MODE_LABELS } from "@/modules/shops/fields";
import { Checklist } from "./checklist";
import { ActionsHeader, RowActions } from "@/components/row-actions";

export const metadata: Metadata = { title: "Launch readiness" };

/**
 * Activation manifest for every in-scope shop (SR-37, PDF 09). A shop that
 * fails a check is listed with what is missing, never hidden. Nothing on this
 * page switches a shop to Live or sends anything.
 */
export default async function ReadinessPage({ searchParams }: PageProps<"/psg/readiness">) {
  await pageRequireCapability("psg.workspace");
  const [query, { email, shops, testShops }] = await Promise.all([searchParams, getManifest()]);
  const list = pageOf(shops, pageNumber(query.page));
  const ready = shops.filter((s) => s.ready).length;
  const emailOk = email.every((c) => c.status === "pass");

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Launch readiness</h1>
        {/* The whole manifest, every shop and check, to keep as launch evidence (WP-11). */}
        <a
          href="/psg/readiness/export"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <Download className="size-4" aria-hidden="true" />
          Export CSV
        </a>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Every shop in scope, with what is still missing before it can go Live. Checks from the shop&apos;s settings update by themselves; the others are confirmed by a PSG admin with a note. A
        shop&apos;s first switch to Live needs every check; it stays a deliberate step on the shop&apos;s page.
      </p>
      <p className="mt-3 text-sm text-gray-900">
        <span className="font-semibold">
          {ready} of {shops.length}
        </span>{" "}
        shop{shops.length === 1 ? "" : "s"} ready to launch.
      </p>

      <section aria-labelledby="email-heading" className={`mt-5 rounded-xl border bg-white p-4 ${emailOk ? "border-gray-200" : "border-brand-red/60"}`}>
        <h2 id="email-heading" className="text-sm font-semibold text-brand-navy-900">
          Email sending, shared by every shop
        </h2>
        {!emailOk && <p className="mt-1 text-xs text-brand-red-dark">No shop can be ready until this passes.</p>}
        <Checklist shopId="" checks={email} canManage={false} />
      </section>

      <div className="relative mt-5 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Shop
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Mode
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Still missing
              </th>
              <ActionsHeader />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.total === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                  No shops yet.
                </td>
              </tr>
            )}
            {list.items.map((s) => {
              const own = s.missing.filter((c) => !c.key.startsWith("email_"));
              return (
                <tr key={s.shopId} className="align-top">
                  <td className="px-3 py-2.5">
                    <Link href={`/psg/shops/${s.shopId}#readiness`} className="font-medium text-brand-navy-900 underline-offset-2 hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">{MODE_LABELS[s.mode]}</td>
                  <td className="px-3 py-2.5">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${s.ready ? "bg-emerald-100 text-emerald-800" : "bg-brand-red/10 text-brand-red-dark"}`}>
                      {s.ready ? "Ready" : `${s.missing.length} missing`}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-700">{own.length === 0 ? (s.ready ? "Nothing" : "Only the shared email setup") : own.map((c) => c.label).join(", ")}</td>
                  <td className="px-4 py-3">
                    <RowActions
                      actions={[
                        {
                          kind: "edit",
                          label: "Checklist",
                          href: `/psg/shops/${s.shopId}#readiness`,
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination {...list} path="/psg/readiness" query={query} label="Readiness pages" />

      {testShops.length > 0 && (
        <p className="mt-4 text-xs text-gray-600">Not in scope (internal test shops, which never go Live and never count in reports): {testShops.map((t) => t.name).join(", ")}.</p>
      )}
    </div>
  );
}
