import { UnauthenticatedError, isAccessError } from "@/modules/access/errors";
import { parseFilters, localDate } from "@/modules/dashboard/cohort";
import { exportCsv } from "@/modules/dashboard/dashboard";

/**
 * Authorized CSV export of the dashboard cohort (SR-31, AT-31, AT-40). The
 * same filters give the same rows as the screen. Another shop's id is a 404.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop") ?? "";
  const filters = parseFilters(Object.fromEntries(url.searchParams), localDate(new Date(), "America/New_York"));
  try {
    const result = await exportCsv(shopId, filters);
    if (!result) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        // Customer answers: never cached by browsers or proxies.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    if (isAccessError(error)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    throw error;
  }
}
