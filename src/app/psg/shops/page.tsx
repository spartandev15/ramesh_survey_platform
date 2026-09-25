import type { Metadata } from "next";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listVisibleShops } from "@/modules/shops/shops";
import { CreateShopForm } from "./create-shop-form";

export const metadata: Metadata = { title: "Shops" };

export default async function ShopsPage() {
  const current = await pageRequireCapability("psg.workspace");
  const shops = await listVisibleShops();
  const canManage = hasCapability(current.principal, "shop.manage");

  return (
    <div className="grid max-w-6xl gap-8 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold text-brand-navy-900">Shops</h1>
        <p className="mt-1 text-sm text-gray-500">{shops.length} active shops</p>
        <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Name</th>
                <th scope="col" className="px-4 py-3 font-medium">Public link</th>
                <th scope="col" className="px-4 py-3 font-medium">Timezone</th>
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shops.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No shops yet.
                  </td>
                </tr>
              )}
              {shops.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">/survey/shop/{s.publicSlug}</td>
                  <td className="px-4 py-3 text-gray-600">{s.timezone}</td>
                  <td className="px-4 py-3">
                    {s.isTestShop ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Internal test</span>
                    ) : (
                      <span className="text-gray-600">Production</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {canManage && (
        <section aria-labelledby="new-shop" className="h-fit rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="new-shop" className="text-base font-semibold text-brand-navy-900">
            Add a shop
          </h2>
          <div className="mt-4">
            <CreateShopForm />
          </div>
        </section>
      )}
    </div>
  );
}
