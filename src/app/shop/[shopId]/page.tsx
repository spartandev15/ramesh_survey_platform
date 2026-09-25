import { notFound } from "next/navigation";
import { pageRequireShopRead } from "@/modules/access/page-guards";
import { getShop } from "@/modules/shops/shops";

export default async function ShopDashboardPage({ params }: PageProps<"/shop/[shopId]">) {
  const { shopId } = await params;
  await pageRequireShopRead(shopId);
  const shop = await getShop(shopId);
  if (!shop) notFound();

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Survey dashboard</h1>
      <p className="mt-1 text-sm text-gray-500">{shop.name}</p>
      <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
        Survey results will appear here once the survey module is live.
      </div>
    </div>
  );
}
