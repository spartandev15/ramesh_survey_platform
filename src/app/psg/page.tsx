import { Activity, AlertTriangle, ArrowLeftRight, BarChart3, Calendar, CheckCircle2, ChevronRight, CircleX, ListChecks, Mail, MessageSquareWarning, Store, Target, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Donut, Legend, MiniBars, Sparkline, SplitBar, TrendChart } from "@/components/dashboard/charts";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { operatorQueueSummary } from "@/modules/operations/operations";
import { projectOverview } from "@/modules/operations/overview";
import { countActiveShops } from "@/modules/shops/shops";

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const monthLabel = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const hourInNewYork = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" });

function minutesSince(date: Date | null) {
  if (!date) return null;
  const m = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
}

function timeAgo(date: Date) {
  const m = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000));
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return d < 31 ? `${d} day${d === 1 ? "" : "s"} ago` : dateTime.format(date);
}

function greeting() {
  const hour = Number(hourInNewYork.format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
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

const ALERT_STATUS: Record<string, { title: string; icon: LucideIcon; tone: string }> = {
  pending_review: { title: "Negative feedback received", icon: AlertTriangle, tone: "bg-rose-50 text-rose-600" },
  approved: { title: "Alert approved and sent", icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600" },
  dismissed: { title: "Alert dismissed", icon: CircleX, tone: "bg-gray-100 text-gray-500" },
};

export default async function PsgOverviewPage({ searchParams }: PageProps<"/psg">) {
  const current = await pageRequireCapability("operations.view");
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
  const monthlyMatch = months.map((m) => (m.submitted > 0 ? Math.round((m.matched / m.submitted) * 100) : 0));
  const cumulative = months.map((_, i) => months.slice(0, i + 1).reduce((t, m) => t + m.submitted, 0));
  const firstName = current.name.trim().split(/\s+/)[0] || current.name;
  const pct = (v: number) => (submitted > 0 ? Math.round((v / submitted) * 100) : 0);
  const fmt = (v: number) => v.toLocaleString("en-US");
  const latest = months.at(-1);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">
            {greeting()}, {firstName}! <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">Here&apos;s what&apos;s happening across all shops.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={includeTest ? "/psg" : "/psg?test=1"}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm transition hover:border-indigo-300 hover:text-indigo-700"
          >
            {includeTest ? "Showing test data · Hide it" : "Production only · Include test data"}
          </Link>
          <span className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm">
            <Calendar aria-hidden="true" className="size-4 text-gray-500" />
            Last 12 months
          </span>
        </div>
      </div>

      {/* Headline numbers */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi tone="blue" icon={Store} label="Total responses" value={fmt(totals.responses)} note="Last 12 months">
          <Sparkline id="kpi-total" values={cumulative} color="#4f7cf7" label="Responses so far, month by month" className="h-10 w-20 sm:w-24" />
        </Kpi>
        <Kpi
          tone="green"
          icon={BarChart3}
          label="Responses this month"
          value={fmt(totals.lastMonth)}
          note={change === null ? "No earlier month yet" : `${Math.abs(change)}% vs last month`}
          trend={change === null ? undefined : change >= 0 ? "up" : "down"}
        >
          <Sparkline id="kpi-month" values={months.map((m) => m.submitted)} color="#10b981" label="Responses per month" className="h-10 w-20 sm:w-24" />
        </Kpi>
        <Kpi tone="purple" icon={Target} label="Match rate" value={`${matchRate}%`} note={`${fmt(matching.pending)} waiting for a match`}>
          <Sparkline id="kpi-match" values={monthlyMatch} color="#8b5cf6" label="Share matched to a visit, per month" className="h-10 w-20 sm:w-24" />
        </Kpi>
        <Kpi tone="orange" icon={AlertTriangle} label="Negative feedback" value={fmt(alertTotal)} note={`${alerts.pending_review} waiting for review`}>
          <Sparkline id="kpi-alerts" values={months.map((m) => m.alerts)} color="#f43f5e" label="Negative feedback per month" className="h-10 w-20 sm:w-24" />
        </Kpi>
      </div>

      {/* Work waiting */}
      <div className="grid gap-4 sm:grid-cols-3">
        <WorkTile href="/psg/shops" icon={Store} iconTone="bg-indigo-50 text-indigo-600" label="Active shops" value={shops}>
          {project.shops.live} live · {project.shops.test} in test · {project.shops.paused} paused
        </WorkTile>
        <WorkTile href="/psg/operations" icon={ListChecks} iconTone="bg-teal-50 text-teal-700" label="Operator items waiting" value={open} alert={overdue > 0}>
          {overdue > 0 ? <span className="font-medium text-brand-red-dark">{overdue} overdue</span> : "None overdue"} · {unowned} without an owner
        </WorkTile>
        <WorkTile href="/psg/alerts" icon={MessageSquareWarning} iconTone="bg-rose-50 text-rose-600" label="Alerts to review" value={alerts.pending_review} alert={alerts.pending_review > 0}>
          {alerts.follow_up_open} follow-up{alerts.follow_up_open === 1 ? "" : "s"} open · {alerts.resolved} resolved
        </WorkTile>
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card title="Responses trend" className="lg:col-span-3" aside={<Chip>Last 12 months</Chip>}>
          <Legend
            items={[
              { label: "Submitted", color: C.total },
              { label: "Matched to a visit", color: C.counted },
              { label: "With negative feedback", color: C.negative },
            ]}
          />
          {totals.responses === 0 ? (
            <p className="flex h-60 items-center justify-center text-sm text-gray-500">No responses in the last 12 months.</p>
          ) : (
            <TrendChart
              id="overview-months"
              fromZero
              height="h-60"
              labels={monthLabels}
              series={[
                { key: "submitted", label: "Submitted", color: C.total, values: months.map((m) => m.submitted), area: true },
                { key: "matched", label: "Matched", color: C.counted, values: months.map((m) => m.matched), area: true },
                { key: "alerts", label: "Negative feedback", color: C.negative, values: months.map((m) => m.alerts) },
              ]}
            />
          )}
        </Card>
        <Card title="Where responses came from" className="lg:col-span-2">
          <div className="flex flex-1 flex-col items-center justify-center gap-6 py-2 sm:flex-row lg:flex-col xl:flex-row">
            <Donut
              total={submitted}
              caption="Submitted"
              size="size-44"
              thickness={7}
              parts={[
                { label: "Online link", value: sources.online, color: C.total },
                { label: "Paper", value: sources.paper, color: C.paper },
                { label: "Public form", value: sources.public, color: C.pending },
              ]}
            />
            <ul className="flex flex-col gap-3 text-sm">
              {(
                [
                  ["Online link", sources.online, C.total],
                  ["Paper", sources.paper, C.paper],
                  ["Public form", sources.public, C.pending],
                ] as const
              ).map(([label, value, color]) => (
                <li key={label} className="flex items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
                  <span className="text-gray-600">{label}</span>
                  <span className="font-semibold tabular-nums text-brand-navy-900">{fmt(value)}</span>
                  <span className="text-xs tabular-nums text-gray-500">({pct(value)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {/* Month by month */}
      {totals.responses > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Responses" tone="bg-emerald-50 border-emerald-100" valueTone="text-emerald-700" value={fmt(latest?.submitted ?? 0)}>
            <MiniBars labels={monthLabels} values={months.map((m) => m.submitted)} color="#10b981" />
          </MetricCard>
          <MetricCard title="Negative feedback" tone="bg-rose-50 border-rose-100" valueTone="text-rose-600" value={fmt(latest?.alerts ?? 0)}>
            <MiniBars labels={monthLabels} values={months.map((m) => m.alerts)} color="#f43f5e" />
          </MetricCard>
          <MetricCard title="Survey emails sent" tone="bg-blue-50 border-blue-100" valueTone="text-blue-700" value={fmt(latest?.emails ?? 0)}>
            <MiniBars labels={monthLabels} values={months.map((m) => m.emails)} color="#4f7cf7" />
          </MetricCard>
          <MetricCard title="Matched to a visit" tone="bg-orange-50 border-orange-100" valueTone="text-orange-600" value={`${monthlyMatch.at(-1) ?? 0}%`}>
            <MiniBars labels={monthLabels} values={monthlyMatch} color="#f59e0b" valueLabel={(v) => `${v}%`} />
          </MetricCard>
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

      {/* Busiest shops and recent alerts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Busiest shops (last 90 days)" className="lg:col-span-2">
          {project.topShops.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">No responses in the last 90 days.</p>
          ) : (
            <div className="relative -mx-5 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium text-gray-500">
                    <th scope="col" className="px-5 pb-2 font-medium">Shop</th>
                    <th scope="col" className="px-3 pb-2 font-medium">Responses</th>
                    <th scope="col" className="px-3 pb-2 font-medium">Negative feedback</th>
                    <th scope="col" className="px-3 pb-2 font-medium">Trend</th>
                    <th scope="col" className="px-5 pb-2">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {project.topShops.map((s, i) => {
                    const width = Math.max(4, Math.round((s.responses / project.topShops[0].responses) * 100));
                    return (
                      <tr key={s.id} className="border-b border-gray-50 last:border-0">
                        <td className="max-w-64 px-5 py-3">
                          <p className="truncate font-medium text-brand-navy-900">{s.name}</p>
                          {s.isTest && <p className="text-xs text-gray-500">Internal test shop</p>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-indigo-50">
                              <div className="h-full rounded-full bg-indigo-500" style={{ width: `${width}%` }} />
                            </div>
                            <span className="tabular-nums text-gray-700">{fmt(s.responses)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-gray-700">{fmt(s.alerts)}</td>
                        <td className="px-3 py-3">
                          <Sparkline id={`shop-trend-${i}`} values={s.weekly} color="#10b981" label={`${s.name}: responses per week`} className="h-7 w-24" />
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            href={`/psg/dashboard?shop=${s.id}`}
                            aria-label={`Dashboard for ${s.name}`}
                            title="Dashboard"
                            className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 hover:text-indigo-600"
                          >
                            <ChevronRight aria-hidden="true" className="size-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card
          title="Recent alerts"
          aside={
            <Link href="/psg/alerts" className="text-xs font-medium text-indigo-600 hover:underline">
              View all →
            </Link>
          }
        >
          {project.recentAlerts.length === 0 ? (
            <p className="py-4 text-sm text-gray-500">No alerts yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {project.recentAlerts.map((a) => {
                const s = ALERT_STATUS[a.status] ?? ALERT_STATUS.pending_review;
                return (
                  <li key={a.id}>
                    <Link href={`/psg/alerts/${a.id}`} className="-mx-2 flex items-start gap-3 rounded-xl p-2 transition hover:bg-gray-50">
                      <span className={`rounded-lg p-2 ${s.tone}`} aria-hidden="true">
                        <s.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-brand-navy-900">{s.title}</span>
                        <span className="block truncate text-xs text-gray-500">Shop: {a.shopName ?? "Unknown"}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-gray-500">{timeAgo(a.createdAt)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Health */}
      <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-brand-navy-900">System health</h2>
          <Link href="/psg/operations" className="text-xs font-medium text-indigo-600 hover:underline">
            View system status →
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Health
            href="/psg/email"
            icon={Mail}
            iconTone="bg-blue-50 text-blue-600"
            title="Survey email"
            ok={health.email.problems === 0}
            status={health.email.problems === 0 ? "Operational" : "Needs a look"}
            lines={[`${health.email.sent24h} sent in the last 24 hours`, `${health.email.queued > 0 ? `${health.email.queued} due now, oldest waiting ${oldestEmail}` : "Nothing waiting to send"} · ${health.email.problems} to review`]}
          />
          <Health
            href="/psg/operations?kind=worker"
            icon={Activity}
            iconTone="bg-emerald-50 text-emerald-600"
            title="Background worker"
            ok={health.worker.healthy}
            status={health.worker.healthy ? "Running" : "Not running"}
            lines={[`Last heartbeat: ${health.worker.lastHeartbeat ? dateTime.format(health.worker.lastHeartbeat) : "never"}`]}
          />
          <Health
            href="/psg/bridge"
            icon={ArrowLeftRight}
            iconTone="bg-violet-50 text-violet-600"
            title="FileMaker bridge"
            ok={health.bridge.writesOn && health.bridge.problems === 0}
            status={!health.bridge.writesOn ? "Writes off" : health.bridge.problems === 0 ? "Writing" : "Needs a look"}
            lines={[`${health.bridge.waiting} waiting · ${health.bridge.problems} to review`, `Last confirmed write: ${health.bridge.lastConfirmed ? dateTime.format(health.bridge.lastConfirmed) : "never"}`]}
          />
        </div>
      </section>
    </div>
  );
}

const KPI_TONES = {
  blue: { card: "bg-linear-to-br from-blue-50 to-white border-blue-100", icon: "bg-blue-100 text-blue-600" },
  green: { card: "bg-linear-to-br from-emerald-50 to-white border-emerald-100", icon: "bg-emerald-100 text-emerald-600" },
  purple: { card: "bg-linear-to-br from-violet-50 to-white border-violet-100", icon: "bg-violet-100 text-violet-600" },
  orange: { card: "bg-linear-to-br from-orange-50 to-white border-orange-100", icon: "bg-orange-100 text-orange-600" },
};

function Kpi({ tone, icon: Icon, label, value, note, trend, children }: { tone: keyof typeof KPI_TONES; icon: LucideIcon; label: string; value: string; note: string; trend?: "up" | "down"; children: React.ReactNode }) {
  const t = KPI_TONES[tone];
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : null;
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border p-5 shadow-sm ${t.card}`}>
      <div className="flex items-start gap-3">
        <span className={`rounded-xl p-2.5 ${t.icon}`} aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm text-gray-600">{label}</p>
          <p className="text-2xl font-semibold tabular-nums text-brand-navy-900">{value}</p>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className={`flex min-w-0 items-center gap-1 text-xs ${trend === "up" ? "text-emerald-700" : trend === "down" ? "text-rose-600" : "text-gray-500"}`}>
          {TrendIcon && <TrendIcon aria-hidden="true" className="size-3.5" />}
          {note}
        </p>
        <div className="shrink-0">{children}</div>
      </div>
    </div>
  );
}

function WorkTile({ href, icon: Icon, iconTone, label, value, alert = false, children }: { href: string; icon: LucideIcon; iconTone: string; label: string; value: number; alert?: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`flex items-center gap-4 rounded-2xl border bg-white px-5 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${alert ? "border-rose-200" : "border-gray-200/80"}`}>
      <span className={`rounded-xl p-2.5 ${iconTone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-gray-500">{label}</span>
        <span className="block truncate text-xs text-gray-600">{children}</span>
      </span>
      <span className="text-2xl font-semibold tabular-nums text-brand-navy-900">{value}</span>
    </Link>
  );
}

function MetricCard({ title, tone, valueTone, value, children }: { title: string; tone: string; valueTone: string; value: string; children: React.ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col gap-4 rounded-2xl border p-5 shadow-sm ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-brand-navy-900">{title}</h2>
          <p className="text-xs text-gray-500">Latest month</p>
        </div>
        <p className={`text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      </div>
      {children}
    </section>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600">{children}</span>;
}

function Card({ title, className = "", aside, children }: { title: string; className?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`flex min-w-0 flex-col gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-brand-navy-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="mt-auto pt-1 text-xs font-medium text-indigo-600 hover:underline">
      {children} →
    </Link>
  );
}

function Health({ href, icon: Icon, iconTone, title, ok, status, lines }: { href: string; icon: LucideIcon; iconTone: string; title: string; ok: boolean; status: string; lines: string[] }) {
  return (
    <Link href={href} className="flex gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-4 transition hover:border-gray-200 hover:bg-white">
      <span className={`h-fit rounded-xl p-2.5 ${iconTone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-brand-navy-900">{title}</span>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${ok ? "text-emerald-700" : "text-brand-red-dark"}`}>
            <span className={`size-2 rounded-full ${ok ? "bg-emerald-500" : "bg-brand-red"}`} aria-hidden="true" />
            {status}
          </span>
        </span>
        {lines.map((line) => (
          <span key={line} className="mt-0.5 block text-xs text-gray-500">
            {line}
          </span>
        ))}
      </span>
    </Link>
  );
}
