import { UnauthenticatedError, isAccessError } from "@/modules/access/errors";
import { exportOperatorQueue } from "@/modules/operations/operations";
import { parseQueueSearch, QUEUE_KINDS, type OwnerFilter, type QueueKind } from "@/modules/operations/policy";

/** The operator queue as CSV, with the same queue, owner, test and search filters as the page. PSG staff only. */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const kind = QUEUE_KINDS.includes(params.kind as QueueKind) ? (params.kind as QueueKind) : null;
  const owner: OwnerFilter = params.owner === "mine" || params.owner === "unassigned" ? params.owner : "all";
  try {
    const csv = await exportOperatorQueue({ kind, owner, includeTest: params.test === "1", search: parseQueueSearch(params) });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="operator-queue-${kind ?? "all"}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    if (isAccessError(error)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    throw error;
  }
}
