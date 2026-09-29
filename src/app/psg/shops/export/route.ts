import { toCsv } from "@/lib/csv";
import { UnauthenticatedError, isAccessError } from "@/modules/access/errors";
import { MODE_LABELS } from "@/modules/shops/fields";
import { filterShops, parseShopFilters } from "@/modules/shops/list-filter";
import { listShopModes } from "@/modules/shops/settings";
import { listVisibleShops } from "@/modules/shops/shops";
import { env } from "@/lib/env";

/**
 * Every shop matching the list's search and filters as CSV, not just one
 * page. Shop details only, no customer data. PSG staff only.
 */
export async function GET(request: Request) {
  const filters = parseShopFilters(Object.fromEntries(new URL(request.url).searchParams));
  try {
    // listShopModes is PSG-only, so a shop user gets a 404 here.
    const [all, modes] = await Promise.all([listVisibleShops(), listShopModes()]);
    const appUrl = env().APP_URL.replace(/\/$/, "");
    const rows = filterShops(all, modes, filters).map((s) => [
      s.name,
      `${appUrl}/survey/shop/${s.publicSlug}`,
      s.timezone,
      MODE_LABELS[modes.get(s.id) ?? "test"],
      s.isTestShop ? "Internal test" : "Production",
      s.createdAt.toISOString().slice(0, 10),
    ]);
    const csv = toCsv(["Shop", "Public link", "Time zone", "Mode", "Type", "Created"], rows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="shops-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    if (isAccessError(error)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    throw error;
  }
}
