import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { requireCapability } from "@/modules/access/principal";

/**
 * Whole-project numbers for the PSG Overview: responses per month, where they
 * came from, matching, alerts, email and shops. Production only by default;
 * internal test data is added only when PSG asks for it (SR-03, SR-37).
 */
export interface ProjectOverview {
  months: { month: string; submitted: number; matched: number; alerts: number; emails: number }[];
  sources: Record<"online" | "paper" | "public", number>;
  matching: Record<"matched" | "pending" | "duplicate", number>;
  alerts: Record<"pending_review" | "approved" | "dismissed" | "follow_up_open" | "resolved", number>;
  email: Record<"sent" | "waiting" | "problems", number>;
  shops: Record<"test" | "live" | "paused", number>;
  /** Busiest shops over 90 days, with responses per week (oldest first) for a trend line. */
  topShops: { id: string; name: string; isTest: boolean; responses: number; alerts: number; weekly: number[] }[];
  recentAlerts: { id: string; shopName: string | null; status: string; createdAt: Date }[];
  totals: { responses: number; lastMonth: number; previousMonth: number };
}

const num = (v: unknown) => Number(v ?? 0);

export async function projectOverview(includeTest: boolean): Promise<ProjectOverview> {
  await requireCapability("operations.view");
  const test = includeTest ? sql`TRUE` : sql`NOT r.is_test`;
  return getDb().transaction(async (tx) => {
    // One connection per transaction, so the queries run one after another.
    const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => tx.execute<T>(query);
    const monthSeries = sql`generate_series(date_trunc('month', now() AT TIME ZONE 'America/New_York') - interval '11 months', date_trunc('month', now() AT TIME ZONE 'America/New_York'), interval '1 month') m`;
    const months = await tx.execute<{ month: string; submitted: number; matched: number; alerts: number }>(sql`
        SELECT to_char(m, 'YYYY-MM') AS month,
          count(r.id) AS submitted,
          count(r.id) FILTER (WHERE r.match_status = 'matched' AND r.canonical) AS matched,
          count(DISTINCT a.id) AS alerts
        FROM ${monthSeries}
        LEFT JOIN survey_response r ON r.status = 'submitted' AND ${test} AND date_trunc('month', r.submitted_at AT TIME ZONE 'America/New_York') = m
        LEFT JOIN alert_case a ON a.response_id = r.id
        GROUP BY m ORDER BY m`);
    const emails = await q<{ month: string; n: number }>(sql`
      SELECT to_char(m, 'YYYY-MM') AS month, count(r.id) AS n FROM ${monthSeries}
      LEFT JOIN email_intent r ON r.accepted_at IS NOT NULL AND ${test} AND date_trunc('month', r.accepted_at AT TIME ZONE 'America/New_York') = m
      GROUP BY m ORDER BY m`);
    const sources = await q<{ source: string; n: number }>(sql`SELECT source, count(*) AS n FROM survey_response r WHERE status = 'submitted' AND ${test} GROUP BY source`);
    const matching = await q<{ status: string; n: number }>(sql`SELECT match_status AS status, count(*) AS n FROM survey_response r WHERE status = 'submitted' AND ${test} GROUP BY match_status`);
    const alerts = await q<{ status: string; follow_up: string; n: number }>(sql`SELECT status, follow_up, count(*) AS n FROM alert_case r WHERE ${test} GROUP BY status, follow_up`);
    const email = await q<{ state: string; n: number }>(sql`SELECT state, count(*) AS n FROM email_intent r WHERE ${test} GROUP BY state`);
    const shops = await q<{ mode: string; n: number }>(sql`
        SELECT s.mode, count(*) AS n FROM shop_survey_settings s JOIN shop ON shop.id = s.shop_id
        WHERE shop.archived_at IS NULL ${includeTest ? sql`` : sql`AND NOT shop.is_test_shop`} GROUP BY s.mode`);
    const topShops = await q<{ id: string; name: string; is_test_shop: boolean; responses: number; alerts: number }>(sql`
        SELECT shop.id, shop.name, shop.is_test_shop, count(DISTINCT r.id) AS responses, count(DISTINCT a.id) AS alerts
        FROM survey_response r JOIN shop ON shop.id = r.shop_id LEFT JOIN alert_case a ON a.response_id = r.id
        WHERE r.status = 'submitted' AND ${test} AND r.submitted_at >= now() - interval '90 days'
        GROUP BY shop.id, shop.name ORDER BY responses DESC LIMIT 5`);
    // Weeks back from now: 12 is the oldest of the 13 weeks in 90 days, 0 the current one.
    const weekly = topShops.rows.length
      ? await q<{ shop_id: string; w: number; n: number }>(sql`
        SELECT r.shop_id, floor(extract(epoch FROM now() - r.submitted_at) / 604800)::int AS w, count(*) AS n
        FROM survey_response r
        WHERE r.status = 'submitted' AND ${test} AND r.submitted_at >= now() - interval '91 days'
          AND r.shop_id IN (${sql.join(topShops.rows.map((s) => sql`${s.id}::uuid`), sql`, `)})
        GROUP BY 1, 2`)
      : { rows: [] };
    const recentAlerts = await q<{ id: string; shop_name: string | null; status: string; created_at: string }>(sql`
        SELECT r.id, shop.name AS shop_name, r.status, r.created_at FROM alert_case r LEFT JOIN shop ON shop.id = r.shop_id
        WHERE ${test} ORDER BY r.created_at DESC LIMIT 4`);

    const by = <K extends string>(rows: { n: number }[], key: (r: never) => string, keys: K[]) => {
      const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
      for (const r of rows) {
        const k = key(r as never) as K;
        if (k in out) out[k] += num(r.n);
      }
      return out;
    };
    const m = matching.rows;
    const matchCount = (s: string[]) => m.filter((r) => s.includes(r.status)).reduce((a, r) => a + num(r.n), 0);
    const a = alerts.rows;
    const alertCount = (f: (r: (typeof a)[number]) => boolean) => a.filter(f).reduce((t, r) => t + num(r.n), 0);
    const e = email.rows;
    const emailCount = (s: string[]) => e.filter((r) => s.includes(r.state)).reduce((t, r) => t + num(r.n), 0);
    const sent = new Map(emails.rows.map((r) => [r.month, num(r.n)]));
    const monthRows = months.rows.map((r) => ({ month: r.month, submitted: num(r.submitted), matched: num(r.matched), alerts: num(r.alerts), emails: sent.get(r.month) ?? 0 }));

    return {
      months: monthRows,
      sources: by(sources.rows, (r: { source: string }) => r.source, ["online", "paper", "public"]),
      matching: { matched: matchCount(["matched"]), pending: matchCount(["visit_unmatched", "shop_unconfirmed"]), duplicate: matchCount(["duplicate_review"]) },
      alerts: {
        pending_review: alertCount((r) => r.status === "pending_review"),
        approved: alertCount((r) => r.status === "approved"),
        dismissed: alertCount((r) => r.status === "dismissed"),
        follow_up_open: alertCount((r) => r.follow_up === "open" || r.follow_up === "closure_requested"),
        resolved: alertCount((r) => r.follow_up === "resolved"),
      },
      email: { sent: emailCount(["accepted", "delivered"]), waiting: emailCount(["queued", "held", "sending"]), problems: emailCount(["bounced", "failed", "acceptance_unknown"]) },
      shops: by(shops.rows, (r: { mode: string }) => r.mode, ["test", "live", "paused"]),
      topShops: topShops.rows.map((r) => {
        const weeks = Array.from({ length: 13 }, () => 0);
        for (const w of weekly.rows) if (w.shop_id === r.id && w.w >= 0 && w.w < 13) weeks[12 - w.w] += num(w.n);
        return { id: r.id, name: r.name, isTest: r.is_test_shop, responses: num(r.responses), alerts: num(r.alerts), weekly: weeks };
      }),
      recentAlerts: recentAlerts.rows.map((r) => ({ id: r.id, shopName: r.shop_name, status: r.status, createdAt: new Date(r.created_at) })),
      totals: {
        responses: monthRows.reduce((t, r) => t + r.submitted, 0),
        lastMonth: monthRows.at(-1)?.submitted ?? 0,
        previousMonth: monthRows.at(-2)?.submitted ?? 0,
      },
    };
  });
}
