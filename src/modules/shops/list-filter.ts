import { SHOP_MODES, type ShopMode } from "./settings-policy";

/**
 * Search, filters and sort for the shop list. The same filters drive the
 * screen and the CSV export, so both always show the same shops.
 */
export const SHOP_SORTS = { name: "Name A to Z", name_desc: "Name Z to A", newest: "Newest first", oldest: "Oldest first" } as const;
export const SHOP_TYPES = { all: "All types", production: "Production", test: "Internal test" } as const;

export interface ShopListFilters {
  q: string;
  mode: "all" | ShopMode;
  type: keyof typeof SHOP_TYPES;
  sort: keyof typeof SHOP_SORTS;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseShopFilters(params: Params): ShopListFilters {
  const mode = one(params.mode);
  const type = one(params.type);
  const sort = one(params.sort);
  return {
    q: one(params.q).trim().slice(0, 100),
    mode: (SHOP_MODES as readonly string[]).includes(mode) ? (mode as ShopMode) : "all",
    type: type in SHOP_TYPES ? (type as ShopListFilters["type"]) : "all",
    sort: sort in SHOP_SORTS ? (sort as ShopListFilters["sort"]) : "name",
  };
}

/** Only the filters that differ from the defaults, for links and the export. */
export function shopFilterQuery(f: ShopListFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out.q = f.q;
  if (f.mode !== "all") out.mode = f.mode;
  if (f.type !== "all") out.type = f.type;
  if (f.sort !== "name") out.sort = f.sort;
  return out;
}

interface ListedShop {
  id: string;
  name: string;
  publicSlug: string;
  isTestShop: boolean;
  createdAt: Date;
}

export function filterShops<T extends ListedShop>(shops: T[], modes: Map<string, ShopMode>, f: ShopListFilters): T[] {
  const q = f.q.toLowerCase();
  const kept = shops.filter(
    (s) =>
      (!q || s.name.toLowerCase().includes(q) || s.publicSlug.toLowerCase().includes(q)) &&
      (f.mode === "all" || (modes.get(s.id) ?? "test") === f.mode) &&
      (f.type === "all" || s.isTestShop === (f.type === "test")),
  );
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }) || a.id.localeCompare(b.id);
  const byDate = (a: T, b: T) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  const order = { name: byName, name_desc: (a: T, b: T) => byName(b, a), oldest: byDate, newest: (a: T, b: T) => byDate(b, a) }[f.sort];
  return kept.sort(order);
}
