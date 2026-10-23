import { Clock, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DashboardView, exportQuery } from "@/components/dashboard/dashboard-view";
import { LiveForm } from "@/components/live-form";
import { pageNumber } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { localDate, parseFilters } from "@/modules/dashboard/cohort";
import { getDashboard, listView } from "@/modules/dashboard/dashboard";
import { listVisibleShops } from "@/modules/shops/shops";

export const metadata: Metadata = { title: "Dashboard" };

/** PSG sees any shop's dashboard exactly as that shop does (SR-31). */
export default async function PsgDashboardPage({ searchParams }: PageProps<"/psg/dashboard">) {
  await pageRequireCapability("psg.workspace");
  const params = await searchParams;
  const shops = await listVisibleShops();
  const shop = shops.find((s) => s.id === params.shop) ?? shops[0];
  const filters = parseFilters(params, localDate(new Date(), shop?.timezone ?? "America/New_York"));
  const data = shop ? await getDashboard(shop.id, filters, pageNumber(params.page), listView(params.show)) : null;
  const asOf = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: shop?.timezone ?? "America/New_York", timeZoneName: "short" }).format(new Date());

  // Changing shop keeps the period and filters; without JavaScript the Show button submits.
  const picker = (
    <LiveForm label="Choose a shop" className="flex items-end gap-2">
      {Object.entries(params).map(([k, v]) => (typeof v === "string" && k !== "shop" && k !== "page" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div data-tour="shop" className="relative flex flex-col gap-1">
        <label htmlFor="dashboard-shop" className="text-[11px] font-medium text-gray-500">
          Shop
        </label>
        <Store aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 size-4 text-indigo-500" />
        <select id="dashboard-shop" name="shop" defaultValue={shop?.id} className="h-10 w-80 max-w-[70vw] rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-gray-800 shadow-sm">
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isTestShop && !/internal test/i.test(s.name) ? " (internal test)" : ""}
            </option>
          ))}
        </select>
      </div>
      <noscript>
        <button type="submit" className="h-10 rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm">
          Show
        </button>
      </noscript>
    </LiveForm>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-gray-500">
            <Link href="/psg" className="hover:text-brand-navy-900 hover:underline">
              Home
            </Link>
            <span aria-hidden="true" className="mx-1.5">
              ›
            </span>
            <span aria-current="page">Dashboard</span>
          </nav>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Dashboard</h1>
            {shop?.isTestShop && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Test data</span>}
          </div>
          <p className="mt-1 text-sm text-gray-600">Each shop&apos;s results exactly as that shop sees them: feedback, trends and what needs action.</p>
        </div>
        {shop && (
          <p className="flex items-center gap-1.5 text-xs text-gray-500">
            <Clock aria-hidden="true" className="size-3.5" />
            Live data as of {asOf}
          </p>
        )}
      </div>
      {!shop && <p className="text-sm text-gray-600">Create a shop first.</p>}
      {shop && data && <DashboardView data={data} action="/psg/dashboard" hidden={{ shop: shop.id }} leading={picker} responseHref={(id) => `/psg/responses/${id}`} exportHref={exportQuery(shop.id, filters)} />}
    </div>
  );
}
