import { UnauthenticatedError, isAccessError } from "@/modules/access/errors";
import { noticesFor } from "@/modules/notifications/notifications";

/** The bell's list for the signed-in user: PSG work, or one shop's open follow-ups (?shop=). */
export async function GET(request: Request) {
  try {
    return Response.json(await noticesFor(new URL(request.url).searchParams.get("shop")), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    if (isAccessError(error)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    throw error;
  }
}
