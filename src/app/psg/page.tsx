import { Activity, AlertTriangle, ArrowLeftRight, ListChecks, Mail, Store, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Donut, Legend, LineCard, SplitBar, TrendChart } from "@/components/dashboard/charts";
import { RowActions } from "@/components/row-actions";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { operatorQueueSummary } from "@/modules/operations/operations";
import { projectOverview } from "@/modules/operations/overview";
import { countActiveShops } from "@/modules/shops/shops";

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

function minutesSince(date: Date | null) {
  if (!date) return null;
  const m = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
}

const C = {
  total: "var(--color-chart-total)",
  counted: "var(--color-chart-counted)",
  pending: "var(--color-chart-pending)",
  negative: "var(--color-chart-negative)",
  paper: "var(--color-chart-paper)",
  public: "var(--color-chart-public)",
  other: "var(--color-chart-other)",
};

type Tone = "ok" | "warn" | "bad";
const TONES: Record<Tone, { border: string; dot: string; label: string }> = {
  ok: { border: "border-gray-200/80", dot: "bg-teal-500", label: "OK" },
  warn: { border: "border-amber-300", dot: "bg-amber-500", label: "Needs a look" },
  bad: { border: "border-brand-red/60", dot: "bg-brand-red", label: "Action needed" },
};

export default async function PsgOverviewPage({ searchParams }: PageProps<"/psg">) {
  await pageRequireCapability("operations.view");
  const includeTest = (await searchParams).test === "1";
  // Operator work is production only; the project numbers add test data only on request.
  const [shops, { open, overdue, unowned, health }, project] = await Promise.all([countActiveShops(), operatorQueueSummary(), projectOverview(includeTest)]);
  const oldestEmail = minutesSince(health.email.oldestDue);
  const { totals, months, sources, matching, alerts, email } = project;
  const change = totals.previousMonth > 0 ? Math.round(((totals.lastMonth - totals.previousMonth) / totals.previousMonth) * 100) : null;
  const submitted = sources.online + sources.paper + sources.public;
  const matchRate = submitted > 0 ? Math.round((matching.matched / submitted) * 100) : 0;
  const monthLabels = months.map((m) => monthLabel.format(new Date(`${m.month}-01T00:00:00Z`)));
  const alertTotal = alerts.pending_review + alerts.approved + alerts.dismissed;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      {/* Headline */}
      <section className="relative overflow-hidden rounded-3xl bg-linear-to-br from-[#15171c] via-[#1f2329] to-[#1d3b35] p-6 text-white shadow-lg sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 left-1/3 size-72 rounded-full bg-teal-300/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Overview</h1>
            <p className="mt-1 text-sm text-white/70">Operational status across all shops.</p>
          </div>
          <Link href={includeTest ? "/psg" : "/psg?test=1"} className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20">
            {includeTest ? "Showing test data · Hide it" : "Production only · Include test data"}
          </Link>
        </div>
        <dl className="relative mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Headline label="Responses, last 12 months" value={totals.responses.toLocaleString("en-US")} />
          <Headline
            label="This month"
            value={totals.lastMonth.toLocaleString("en-US")}
            note={change === null ? "No earlier month yet" : `${change >= 0 ? "Up" : "Down"} ${Math.abs(change)}% on last month`}
            trend={change === null ? undefined : change >= 0 ? "up" : "down"}
          />
          <Headline label="Matched to a visit" value={`${matchRate}%`} note={`${matching.pending.toLocaleString("en-US")} waiting for a match`} />
          <Headline label="Negative feedback" value={alertTotal.toLocaleString("en-US")} note={`${alerts.pending_review} waiting for review`} />
        </dl>
      </section>

      {/* Work and shops */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile href="/psg/shops" icon={Store} iconTone="bg-indigo-50 text-indigo-600" tone="ok" status={false}>
          <p className="text-sm text-gray-500">Active shops</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-brand-navy-900">{shops}</p>
          <p className="mt-1 text-xs text-gray-600">
            {project.shops.live} live · {project.shops.test} in test · {project.shops.paused} paused
          </p>
        </Tile>
        <Tile href="/psg/operations" icon={ListChecks} iconTone="bg-teal-50 text-teal-700" tone={overdue > 0 ? "bad" : "ok"} status={false}>
          <p className="text-sm text-gray-500">Operator items waiting</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-brand-navy-900">{open}</p>
          <p className="mt-1 text-xs text-gray-600">
            {overdue > 0 ? <span className="font-medium text-brand-red-dark">{overdue} overdue</span> : "None overdue"} · {unowned} without an owner
          </p>
        </Tile>
        <Tile href="/psg/alerts" icon={AlertTriangle} iconTone="bg-rose-50 text-rose-600" tone={alerts.pending_review > 0 ? "warn" : "ok"} status={false}>
          <p className="text-sm text-gray-500">Alerts to review</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-brand-navy-900">{alerts.pending_review}</p>
          <p className="mt-1 text-xs text-gray-600">
            {alerts.follow_up_open} follow-up{alerts.follow_up_open === 1 ? "" : "s"} open · {alerts.resolved} resolved
          </p>
        </Tile>
      </div>

      {totals.responses === 0 && !includeTest && (
        <p className="rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 text-sm text-indigo-900">
          No production responses yet. Internal test and demo data are kept out of these numbers.{" "}
          <Link href="/psg?test=1" className="font-medium underline underline-offset-2">
            Include test data
          </Link>{" "}
          to see them.
        </p>
      )}

      {/* Trend and sources */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Responses per month" className="lg:col-span-2">
          <div className="mb-3">
            <Legend
              items={[
                { label: "Submitted", color: C.total },
                { label: "Matched to a visit", color: C.counted },
                { label: "With negative feedback", color: C.negative },
              ]}
            />
          </div>
          {totals.responses === 0 ? (
            <p className="flex h-56 items-center justify-center text-sm text-gray-500">No responses in the last 12 months.</p>
          ) : (
            <TrendChart
              id="overview-months"
              fromZero
              labels={monthLabels}
              series={[
                { key: "submitted", label: "Submitted", color: C.total, values: months.map((m) => m.submitted), area: true },
                { key: "matched", label: "Matched", color: C.counted, values: months.map((m) => m.matched) },
                { key: "alerts", label: "Negative feedback", color: C.negative, values: months.map((m) => m.alerts) },
              ]}
            />
          )}
        </Card>
        <Card title="Where responses came from">
          <Donut
            total={submitted}
            caption="submitted"
            parts={[
              { label: "Online link", value: sources.online, color: C.total },
              { label: "Paper", value: sources.paper, color: C.paper },
              { label: "Public form", value: sources.public, color: C.public },
            ]}
          />
          <div className="mt-4">
            <Legend
              items={[
                { label: "Online link", color: C.total, value: sources.online },
                { label: "Paper", color: C.paper, value: sources.paper },
                { label: "Public form", color: C.public, value: sources.public },
              ]}
            />
          </div>
        </Card>
      </div>

      {/* Month by month */}
      {totals.responses > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <LineCard title="Responses" tone="bg-linear-to-br from-emerald-500 to-green-600" labels={monthLabels} values={months.map((m) => m.submitted)} />
          <LineCard title="Negative feedback" tone="bg-linear-to-br from-[#2a2d34] to-[#15171c]" labels={monthLabels} values={months.map((m) => m.alerts)} />
          <LineCard title="Survey emails sent" tone="bg-linear-to-br from-sky-500 to-indigo-600" labels={monthLabels} values={months.map((m) => m.emails)} />
          <LineCard
            title="Matched to a visit"
            tone="bg-linear-to-br from-amber-500 to-orange-600"
            labels={monthLabels}
            values={months.map((m) => (m.submitted > 0 ? Math.round((m.matched / m.submitted) * 100) : 0))}
            valueLabel={(v) => `${v}%`}
          />
        </div>
      )}

      {/* Pipelines */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Matching">
          <SplitBar
            parts={[
              { label: "Matched", value: matching.matched, color: C.counted },
              { label: "Waiting", value: matching.pending, color: C.pending },
              { label: "Duplicate review", value: matching.duplicate, color: C.other },
            ]}
          />
          <Legend
            items={[
              { label: "Matched", color: C.counted, value: matching.matched },
              { label: "Waiting", color: C.pending, value: matching.pending },
              { label: "Duplicate review", color: C.other, value: matching.duplicate },
            ]}
          />
          <CardLink href="/psg/responses">Match responses</CardLink>
        </Card>
        <Card title="Negative feedback">
          <SplitBar
            parts={[
              { label: "To review", value: alerts.pending_review, color: C.negative },
              { label: "Approved", value: alerts.approved, color: C.counted },
              { label: "Dismissed", value: alerts.dismissed, color: C.other },
            ]}
          />
          <Legend
            items={[
              { label: "To review", color: C.negative, value: alerts.pending_review },
              { label: "Approved", color: C.counted, value: alerts.approved },
              { label: "Dismissed", color: C.other, value: alerts.dismissed },
            ]}
          />
          <CardLink href="/psg/alerts">Open alert review</CardLink>
        </Card>
        <Card title="Survey email">
          <SplitBar
            parts={[
              { label: "Sent", value: email.sent, color: C.counted },
              { label: "Waiting", value: email.waiting, color: C.pending },
              { label: "To review", value: email.problems, color: C.negative },
            ]}
          />
          <Legend
            items={[
              { label: "Sent", color: C.counted, value: email.sent },
              { label: "Waiting", color: C.pending, value: email.waiting },
              { label: "To review", color: C.negative, value: email.problems },
            ]}
          />
          <CardLink href="/psg/email">Open email review</CardLink>
        </Card>
      </div>

      {/* Busiest shops */}
      <Card title="Busiest shops, last 90 days">
        {project.topShops.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">No responses in the last 90 days.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {project.topShops.map((s) => {
              const width = Math.max(4, Math.round((s.responses / project.topShops[0].responses) * 100));
              return (
                <li key={s.id} className="grid items-center gap-2 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:gap-4">
                  <p className="truncate text-sm font-medium text-brand-navy-900">{s.name}</p>
                  <div className="flex items-center gap-3">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-linear-to-r from-indigo-500 to-teal-500" style={{ width: `${width}%` }} />
                    </div>
                    <span className="w-28 shrink-0 text-right text-xs tabular-nums text-gray-600">
                      {s.responses} · {s.alerts} alerts
                    </span>
                  </div>
                  <RowActions actions={[{ kind: "view", label: "Dashboard", href: `/psg/dashboard?shop=${s.id}` }]} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Health */}
      <section>
        <h2 className="text-base font-semibold text-brand-navy-900">System health</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <Tile href="/psg/email" icon={Mail} iconTone="bg-sky-50 text-sky-700" tone={health.email.problems > 0 ? "warn" : "ok"}>
            <p className="text-sm text-gray-500">Survey email</p>
            <p className="mt-1 text-sm text-gray-900">{health.email.sent24h} sent in the last 24 hours</p>
            <p className="text-xs text-gray-600">
              {health.email.queued > 0 ? `${health.email.queued} due now, oldest waiting ${oldestEmail}` : "Nothing waiting to send"} · {health.email.problems} to review
            </p>
          </Tile>
          <Tile href="/psg/operations?kind=worker" icon={Activity} iconTone="bg-emerald-50 text-emerald-700" tone={health.worker.healthy ? "ok" : "bad"}>
            <p className="text-sm text-gray-500">Background worker</p>
            <p className={`mt-1 text-sm font-medium ${health.worker.healthy ? "text-emerald-800" : "text-brand-red-dark"}`}>{health.worker.healthy ? "Running" : "Not running"}</p>
            <p className="text-xs text-gray-600">Last heartbeat: {health.worker.lastHeartbeat ? dateTime.format(health.worker.lastHeartbeat) : "never"}</p>
          </Tile>
          <Tile href="/psg/bridge" icon={ArrowLeftRight} iconTone="bg-violet-50 text-violet-700" tone={health.bridge.problems > 0 ? "warn" : "ok"}>
            <p className="text-sm text-gray-500">FileMaker bridge</p>
            <p className="mt-1 text-sm text-gray-900">
              {health.bridge.waiting} waiting · {health.bridge.problems} to review
            </p>
            <p className="text-xs text-gray-600">Last confirmed write: {health.bridge.lastConfirmed ? dateTime.format(health.bridge.lastConfirmed) : "never"}</p>
          </Tile>
        </div>
      </section>
    </div>
  );
}

function Headline({ label, value, note, trend }: { label: string; value: string; note?: string; trend?: "up" | "down" }) {
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : null;
  return (
    <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-sm">
      <dt className="text-xs text-white/70">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
      {note && (
        <dd className="mt-1 flex items-center gap-1 text-xs text-white/75">
          {Icon && <Icon aria-hidden="true" className="size-3.5" />}
          {note}
        </dd>
      )}
    </div>
  );
}

function Card({ title, className = "", children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="text-sm font-semibold text-brand-navy-900">{title}</h2>
      {children}
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-auto pt-1 text-xs font-medium text-indigo-700 hover:underline">
      {children} →
    </Link>
  );
}

function Tile({ href, icon: Icon, iconTone, tone, status = true, children }: { href: string; icon: LucideIcon; iconTone: string; tone: Tone; status?: boolean; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <Link href={href} className={`flex gap-4 rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${t.border}`}>
      <span className={`h-fit rounded-xl p-2.5 ${iconTone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        {children}
        {status && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <span className={`size-2 rounded-full ${t.dot}`} aria-hidden="true" />
            {t.label}
          </p>
        )}
      </div>
    </Link>
  );
}
