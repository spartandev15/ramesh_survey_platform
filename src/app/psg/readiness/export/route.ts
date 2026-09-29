import { toCsv } from "@/lib/csv";
import { UnauthenticatedError, isAccessError } from "@/modules/access/errors";
import { getManifest } from "@/modules/readiness/readiness";
import { MODE_LABELS } from "@/modules/shops/fields";

/**
 * The all-shop launch manifest as CSV, to archive as launch evidence (WP-11,
 * SR-37): one row per shop and check, with who recorded it, when and why.
 * The shared email checks come first. PSG staff only.
 */
export async function GET() {
  try {
    const manifest = await getManifest();
    const at = (d: Date | undefined) => (d ? d.toISOString() : "");
    const rows = [
      ...manifest.email.map((c) => ["All shops (shared email setup)", "", "", "", c.label, c.status, c.detail, "", "", ""]),
      ...manifest.shops.flatMap((s) =>
        s.checks.map((c) => [s.name, MODE_LABELS[s.mode], at(s.activatedAt ?? undefined), s.ready ? "yes" : "no", c.label, c.status, c.detail, c.confirmation?.by ?? "", at(c.confirmation?.at), c.confirmation?.note ?? ""]),
      ),
    ];
    const csv = toCsv(["Shop", "Mode", "First activated", "Ready", "Check", "Status", "Detail", "Recorded by", "Recorded at", "Note"], rows);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="launch-readiness-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    if (isAccessError(error)) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    throw error;
  }
}
