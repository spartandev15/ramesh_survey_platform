import { UnauthenticatedError, isAccessError } from "@/modules/access/errors";
import { parseResponseQuery, selectedIds } from "@/modules/responses/list-query";
import { exportResponsesCsv } from "@/modules/responses/staff";

/**
 * Responses as CSV. With ?id=… (one or more) it exports exactly those
 * responses; without, every response the list's filters match. PSG staff only.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    params[key] = all.length > 1 ? all : all[0];
  }
  const ids = selectedIds(params);
  // The "Export selected" form always sends ?selected=1, so ticking nothing never exports everything.
  const chosen = url.searchParams.has("id") || url.searchParams.has("selected");
  try {
    const result = await exportResponsesCsv(chosen ? { ids } : parseResponseQuery(params));
    if (!result) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    const what = chosen ? (ids.length === 1 ? `response-${ids[0].slice(0, 8)}` : `${ids.length}-selected`) : "all";
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="responses-${what}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    if (isAccessError(error)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    throw error;
  }
}
