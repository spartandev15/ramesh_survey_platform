import type { Metadata } from "next";
import { DashboardView, exportQuery } from "@/components/dashboard/dashboard-view";
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

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-600">Each shop&apos;s results exactly as that shop sees them.</p>
        </div>
        <form action="/psg/dashboard" className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="shop" className="text-xs font-medium text-gray-600">
              Shop
            </label>
            <select id="shop" name="shop" defaultValue={shop?.id} className="w-72 max-w-[60vw] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm">
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.isTestShop ? " (internal test)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm hover:border-brand-navy-700">
            Show
          </button>
        </form>
      </div>
      {!shop && <p className="mt-6 text-sm text-gray-600">Create a shop first.</p>}
      {shop && data && (
        <div className="mt-6">
          <DashboardView data={data} action="/psg/dashboard" hidden={{ shop: shop.id }} responseHref={(id) => `/psg/responses/${id}`} exportHref={exportQuery(shop.id, filters)} />
        </div>
      )}
    </div>
  );
}
