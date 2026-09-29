import { getDb } from "@/db/client";
import { workerHealth } from "@/modules/operations/policy";
import { lastHeartbeat } from "@/modules/operations/store";

/**
 * Liveness for an outside uptime monitor (PDF 09 production readiness). A
 * stopped worker cannot email about itself, so this answers 503 when the
 * database is unreachable or the worker's heartbeat is stale. It needs no
 * sign-in and says nothing beyond up or down.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const beat = await getDb().transaction((tx) => lastHeartbeat(tx));
    const worker = workerHealth(beat, new Date()).ok;
    return Response.json({ status: worker ? "ok" : "degraded", database: "ok", worker: worker ? "ok" : "stopped" }, { status: worker ? 200 : 503, headers });
  } catch {
    return Response.json({ status: "down", database: "unreachable" }, { status: 503, headers });
  }
}
