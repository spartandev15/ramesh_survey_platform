import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardView, exportQuery } from "@/components/dashboard/dashboard-view";
import { pageNumber } from "@/lib/pagination";
import { pageRequireShopRead } from "@/modules/access/page-guards";
import { localDate, parseFilters } from "@/modules/dashboard/cohort";
import { getDashboard, listView } from "@/modules/dashboard/dashboard";
import { getShop } from "@/modules/shops/shops";

export const metadata: Metadata = { title: "Survey dashboard" };

/** The shop's own survey results, visible as soon as they are submitted (SR-27). */
export default async function ShopDashboardPage({ params, searchParams }: PageProps<"/shop/[shopId]">) {
  const { shopId } = await params;
  await pageRequireShopRead(shopId);
  const shop = await getShop(shopId);
  if (!shop) notFound();
  const query = await searchParams;
  const filters = parseFilters(query, localDate(new Date(), shop.timezone));
  const data = await getDashboard(shopId, filters, pageNumber(query.page), listView(query.show));
  if (!data) notFound();

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Survey dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">{shop.name}</p>
      <div className="mt-6">
        <DashboardView data={data} action={`/shop/${shopId}`} responseHref={(id) => `/shop/${shopId}/responses/${id}`} exportHref={exportQuery(shopId, filters)} />
      </div>
    </div>
  );
}
