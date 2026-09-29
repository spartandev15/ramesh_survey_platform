import { Download, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Modal } from "@/components/modal";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listShopModes } from "@/modules/shops/settings";
import { listVisibleShops } from "@/modules/shops/shops";
import { SHOP_MODES } from "@/modules/shops/settings-policy";
import { MODE_LABELS } from "@/modules/shops/fields";
import { SHOP_SORTS, SHOP_TYPES, filterShops, parseShopFilters, shopFilterQuery } from "@/modules/shops/list-filter";
import { CreateShopForm } from "./create-shop-form";
import { ActionsHeader, RowActions } from "@/components/row-actions";
import { env } from "@/lib/env";
import { DeleteShopButton } from "./delete-shop";
import { ModeBadge } from "./mode-badge";
import { PublicLink } from "./public-link";
import { ShopFilters } from "./shop-filters";

export const metadata: Metadata = { title: "Shops" };

export default async function ShopsPage({ searchParams }: PageProps<"/psg/shops">) {
  const current = await pageRequireCapability("psg.workspace");
  const [query, all, modes] = await Promise.all([searchParams, listVisibleShops(), listShopModes()]);
  const filters = parseShopFilters(query);
  const filterQuery = shopFilterQuery(filters);
  const filtered = Object.keys(filterQuery).some((k) => k !== "sort");
  const list = pageOf(filterShops(all, modes, filters), pageNumber(query.page));
  const shops = list.items;
  const canManage = hasCapability(current.principal, "shop.manage");
  const appUrl = env().APP_URL.replace(/\/$/, "");

  return (
    <div className="max-w-6xl">
      <section className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-brand-navy-900">Shops</h1>
            <p className="mt-1 text-sm text-gray-500">{filtered ? `${list.total} of ${all.length} active shops` : `${list.total} active shops`}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/psg/shops/export${Object.keys(filterQuery).length ? `?${new URLSearchParams(filterQuery)}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              <Download className="size-4" aria-hidden="true" />
              Export CSV
            </a>
            {canManage && (
              <Modal
                title="Add a shop"
                buttonClass="inline-flex items-center gap-1.5 rounded-lg bg-brand-red px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-red-dark"
                label={
                  <>
                    <Plus className="size-4" aria-hidden="true" />
                    Add shop
                  </>
                }
              >
                <CreateShopForm />
              </Modal>
            )}
          </div>
        </div>

        <ShopFilters
          values={{ ...filters }}
          modes={{ all: "All modes", ...Object.fromEntries(SHOP_MODES.map((m) => [m, MODE_LABELS[m]])) }}
          types={SHOP_TYPES}
          sorts={SHOP_SORTS}
        />

        <div className="relative mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Name
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Public link
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Mode
                </th>
                <ActionsHeader />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shops.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-left text-gray-500 sm:text-center">
                    {filtered ? "No shops match these filters." : "No shops yet."}
                  </td>
                </tr>
              )}
              {shops.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/psg/shops/${s.id}`} className="text-brand-navy-900 underline-offset-2 hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-xs font-normal text-gray-500">{s.timezone}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="mb-1.5 font-mono text-xs text-gray-600">/survey/shop/{s.publicSlug}</p>
                    <PublicLink shopId={s.id} name={s.name} slug={s.publicSlug} url={`${appUrl}/survey/shop/${s.publicSlug}`} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <ModeBadge mode={modes.get(s.id) ?? "test"} />
                      {s.isTestShop ? <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Internal test</span> : <span className="text-xs text-gray-600">Production</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <RowActions
                        actions={[
                          { kind: "view", label: "Dashboard", href: `/psg/dashboard?shop=${s.id}` },
                          { kind: "edit", label: "Edit", href: `/psg/shops/${s.id}`, title: "Settings, users and questions" },
                        ]}
                      />
                      {canManage && <DeleteShopButton shopId={s.id} name={s.name} />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...list} path="/psg/shops" query={filterQuery} label="Shop pages" />
      </section>
    </div>
  );
}

