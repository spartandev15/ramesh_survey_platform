import { CheckCircle2, Download, FlaskConical, MessageSquareText, PauseCircle, Plus, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Sparkline } from "@/components/dashboard/charts";
import { LiveForm } from "@/components/live-form";
import { Modal } from "@/components/modal";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listShopModes } from "@/modules/shops/settings";
import { listVisibleShops, shopResponseStats } from "@/modules/shops/shops";
import { SHOP_MODES, type ShopMode } from "@/modules/shops/settings-policy";
import { MODE_LABELS } from "@/modules/shops/fields";
import { SHOP_SORTS, SHOP_TYPES, filterShops, parseShopFilters, shopFilterQuery, type ShopListFilters } from "@/modules/shops/list-filter";
import { CreateShopForm } from "./create-shop-form";
import { ActionsHeader, RowActions } from "@/components/row-actions";
import { Kpi } from "@/components/ui";
import { env } from "@/lib/env";
import { DeleteShopButton } from "./delete-shop";
import { ModeBadge } from "./mode-badge";
import { PublicLink } from "./public-link";
import { ShopFilters } from "./shop-filters";

export const metadata: Metadata = { title: "Shops" };

const PAGE_SIZES = [10, 20, 50] as const;
const DAY = 86_400_000;
const created = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
/** A calm colour per shop, picked from its name, so each row is easy to find again. */
const AVATARS = ["bg-indigo-50 text-indigo-600", "bg-emerald-50 text-emerald-600", "bg-rose-50 text-rose-600", "bg-violet-50 text-violet-600", "bg-amber-50 text-amber-600", "bg-sky-50 text-sky-600"];
const avatar = (name: string) => AVATARS[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATARS.length];

export default async function ShopsPage({ searchParams }: PageProps<"/psg/shops">) {
  const current = await pageRequireCapability("psg.workspace");
  const [query, all, modes, stats] = await Promise.all([searchParams, listVisibleShops(), listShopModes(), shopResponseStats()]);
  const filters = parseShopFilters(query);
  const filterQuery = shopFilterQuery(filters);
  const filtered = Object.keys(filterQuery).some((k) => k !== "sort");
  const per = PAGE_SIZES.find((n) => String(n) === query.per) ?? 10;
  const listQuery = per === 10 ? filterQuery : { ...filterQuery, per: String(per) };
  const list = pageOf(filterShops(all, modes, filters), pageNumber(query.page), per);
  const shops = list.items;
  const canManage = hasCapability(current.principal, "shop.manage");
  const appUrl = env().APP_URL.replace(/\/$/, "");
  const now = new Date().getTime();

  // Headline numbers, over every active shop.
  const modeOf = (id: string): ShopMode => modes.get(id) ?? "test";
  const byMode = Object.fromEntries(SHOP_MODES.map((m) => [m, all.filter((s) => modeOf(s.id) === m).length])) as Record<ShopMode, number>;
  const internal = all.filter((s) => s.isTestShop).length;
  const totalResponses = stats.production;
  const addedLately = all.filter((s) => now - s.createdAt.getTime() < 30 * DAY).length;
  const shopsByMonth = Array.from({ length: 12 }, (_, i) => {
    const end = new Date();
    end.setMonth(end.getMonth() - (11 - i) + 1, 1);
    return all.filter((s) => s.createdAt.getTime() < end.getTime()).length;
  });
  const topResponses = Math.max(1, ...shops.map((s) => stats.byShop.get(s.id) ?? 0));

  // Quick filters: one mode or one type at a time, keeping the search and sort.
  const quick = (next: Partial<ShopListFilters>) => {
    const q = shopFilterQuery({ ...filters, mode: "all", type: "all", ...next });
    if (per !== 10) q.per = String(per);
    const s = new URLSearchParams(q).toString();
    return s ? `/psg/shops?${s}` : "/psg/shops";
  };
  const chips: { label: string; count: number; href: string; active: boolean }[] = [
    { label: "All", count: all.length, href: quick({}), active: filters.mode === "all" && filters.type === "all" },
    ...SHOP_MODES.map((m) => ({ label: MODE_LABELS[m], count: byMode[m], href: quick({ mode: m }), active: filters.mode === m && filters.type === "all" })),
    { label: "Internal test", count: internal, href: quick({ type: "test" }), active: filters.type === "test" && filters.mode === "all" },
    { label: "Production", count: all.length - internal, href: quick({ type: "production" }), active: filters.type === "production" && filters.mode === "all" },
  ];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Shops</h1>
          <p className="mt-1 text-sm text-gray-600">Manage your shops and their survey links, modes and settings.</p>
          <p className="mt-0.5 text-xs text-gray-500">{filtered ? `${list.total} of ${all.length} active shops` : `${list.total} active shops`}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/psg/shops/export${Object.keys(filterQuery).length ? `?${new URLSearchParams(filterQuery)}` : ""}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50"
          >
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </a>
          {canManage && (
            <Modal
              title="Add a shop"
              buttonClass="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-700 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800"
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

      {/* Headline numbers */}
      <div data-tour="tiles" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="green" icon={Store} label="Total shops" value={all.length} note={`${addedLately} added in the last 30 days`}>
          <Sparkline id="shops-total" values={shopsByMonth} color="#10b981" label="Shops, month by month" className="h-10 w-24" />
        </Kpi>
        <Kpi tone="blue" icon={CheckCircle2} label="Live shops" value={byMode.live} note={`${all.length ? Math.round((byMode.live / all.length) * 100) : 0}% of shops are live`} />
        <Kpi tone="orange" icon={byMode.paused > 0 ? PauseCircle : FlaskConical} label="In test or paused" value={byMode.test + byMode.paused} note={`${byMode.test} in test · ${byMode.paused} paused`} />
        <Kpi tone="purple" icon={MessageSquareText} label="Total responses" value={totalResponses} note={`Production only · ${stats.monthly.at(-1) ?? 0} this month`}>
          <Sparkline id="shops-responses" values={stats.monthly} color="#8b5cf6" label="Responses per month, last 12 months" className="h-10 w-24" />
        </Kpi>
      </div>

      {/* Search, filters and quick filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
        <ShopFilters
          values={{ ...filters }}
          modes={{ all: "All modes", ...Object.fromEntries(SHOP_MODES.map((m) => [m, MODE_LABELS[m]])) }}
          types={SHOP_TYPES}
          sorts={SHOP_SORTS}
          per={per === 10 ? undefined : String(per)}
        />
        <nav aria-label="Quick filters" className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              aria-current={c.active ? "true" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${c.active ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-600/20" : "bg-gray-50 text-gray-700 ring-1 ring-gray-200 hover:ring-gray-400"}`}
            >
              {c.label} ({c.count})
            </Link>
          ))}
        </nav>
      </div>

      <div className="rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-gray-100 text-xs text-gray-500">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Shop name</th>
                <th scope="col" className="px-4 py-3 font-medium">Public link</th>
                <th scope="col" className="px-4 py-3 font-medium">Mode</th>
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
                <th scope="col" className="px-4 py-3 font-medium">Responses</th>
                <th scope="col" className="px-4 py-3 font-medium">Created</th>
                <ActionsHeader />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shops.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-left text-gray-500 sm:text-center">
                    {filtered ? "No shops match these filters." : "No shops yet."}
                  </td>
                </tr>
              )}
              {shops.map((s) => {
                const responses = stats.byShop.get(s.id) ?? 0;
                return (
                  <tr key={s.id} className="hover:bg-gray-50/60">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className={`rounded-lg p-2 ${avatar(s.name)}`} aria-hidden="true">
                          <Store className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <Link href={`/psg/shops/${s.id}`} className="font-semibold text-brand-navy-900 underline-offset-2 hover:underline">
                            {s.name}
                          </Link>
                          <p className="text-xs text-gray-500">{s.timezone.replace("/", " / ").replace(/_/g, " ")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="mb-1.5 font-mono text-xs text-gray-500">/survey/shop/{s.publicSlug}</p>
                      <PublicLink shopId={s.id} name={s.name} slug={s.publicSlug} url={`${appUrl}/survey/shop/${s.publicSlug}`} />
                    </td>
                    <td className="px-4 py-3">
                      <ModeBadge mode={modeOf(s.id)} />
                    </td>
                    <td className="px-4 py-3">
                      {s.isTestShop ? (
                        <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Internal test</span>
                      ) : (
                        <span className="text-xs text-gray-600">Production</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold tabular-nums text-brand-navy-900">{responses.toLocaleString("en-US")}</p>
                      <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(responses ? 4 : 0, (responses / topResponses) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{created.format(s.createdAt)}</td>
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
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
          <LiveForm label="Page size" className="flex items-center gap-2">
            {Object.entries(listQuery).map(([k, v]) => (k === "per" ? null : <input key={k} type="hidden" name={k} value={v} />))}
            <label htmlFor="shops-per-page" className="text-xs text-gray-500">
              Rows per page
            </label>
            <select id="shops-per-page" name="per" defaultValue={per === 10 ? "" : String(per)} className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-800">
              <option value="">10 per page</option>
              <option value="20">20 per page</option>
              <option value="50">50 per page</option>
            </select>
            <noscript>
              <button type="submit" className="h-8 rounded-lg border border-gray-200 px-2 text-xs">
                Apply
              </button>
            </noscript>
          </LiveForm>
          <div className="min-w-0 flex-1">
            {list.pageCount <= 1 && list.total > 0 && (
              <p className="text-right text-sm text-gray-600">
                Showing all {list.total} shop{list.total === 1 ? "" : "s"}
              </p>
            )}
            <Pagination {...list} path="/psg/shops" query={listQuery} label="Shop pages" />
          </div>
        </div>
      </div>
    </div>
  );
}
