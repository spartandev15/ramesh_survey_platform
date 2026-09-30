import { Activity, AlertTriangle, ArrowRight, Clock, Download, FileUp, Hourglass, Inbox, MailQuestion, MoreHorizontal, Search, UserCheck, UserX, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Donut, Sparkline } from "@/components/dashboard/charts";
import { Pagination } from "@/components/pagination";
import { hasCapability } from "@/modules/access/capabilities";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listOperatorQueues } from "@/modules/operations/operations";
import {
  AGE_BUCKETS,
  ageBuckets,
  filterItems,
  historyLabel,
  parseQueueSearch,
  QUEUE_HELP,
  QUEUE_KINDS,
  QUEUE_LABELS,
  searchItems,
  sortItemsBy,
  SUPPRESSION_OVERDUE_HOURS,
  type OwnerFilter,
  type QueueKind,
} from "@/modules/operations/policy";
import { LiveForm } from "@/components/live-form";
import { OwnerControl, ReviewForm } from "./controls";

export const metadata: Metadata = { title: "Operator queues" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const DAY = 86_400_000;

const OWNER_FILTERS: { key: OwnerFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "No owner" },
];

/** One colour per queue: the card's edge, its tag and its share of the overview ring. */
const KIND_STYLE: Record<QueueKind, { color: string; chip: string }> = {
  held_import: { color: "#10b981", chip: "bg-emerald-50 text-emerald-700" },
  email_unknown: { color: "#0ea5e9", chip: "bg-sky-50 text-sky-700" },
  delivery: { color: "#f59e0b", chip: "bg-amber-50 text-amber-800" },
  worker: { color: "#64748b", chip: "bg-slate-100 text-slate-700" },
  pending_match: { color: "#8b5cf6", chip: "bg-violet-50 text-violet-700" },
  suppression: { color: "#3b82f6", chip: "bg-blue-50 text-blue-700" },
};
const AGE_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#10b981", "#86efac"];

/** Filters the header and toolbar forms own; everything else in the address is kept when they change. */
const HEADER_FIELDS = ["shop", "since"];
const TOOLBAR_FIELDS = ["q", "who", "status", "sort"];

function days(ms: number) {
  return Math.max(0, Math.floor(ms / DAY));
}

function age(since: Date, now: Date): string {
  return duration(now.getTime() - since.getTime());
}

/** A wait in minutes, hours or days, whichever reads best. */
function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

function ago(at: Date, now: Date) {
  const text = age(at, now);
  return text === "0 min" ? "Just now" : `${text} ago`;
}

/** How many of today's open items were already waiting on each of the last 30 days. */
function openByDay(items: { since: Date }[], now: Date) {
  return Array.from({ length: 30 }, (_, d) => {
    const end = now.getTime() - (29 - d) * DAY;
    return items.filter((i) => i.since.getTime() <= end).length;
  });
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

/**
 * Everything that failed or is waiting for a person (SR-38): held imports,
 * unknown or failed emails, background job failures, pending matches and
 * suppression changes. Each item has a reason, an age, an owner and its
 * history; it is fixed on its own page and leaves this list by itself.
 */
export default async function OperationsPage({ searchParams }: PageProps<"/psg/operations">) {
  const current = await pageRequireCapability("operations.view");
  const canReview = hasCapability(current.principal, "operations.manage");
  const params = await searchParams;
  const kind = QUEUE_KINDS.includes(params.kind as QueueKind) ? (params.kind as QueueKind) : null;
  const owner = OWNER_FILTERS.some((f) => f.key === params.owner) ? (params.owner as OwnerFilter) : "all";
  const includeTest = params.test === "1";
  const search = parseQueueSearch(params);
  const now = new Date();

  const { items, operators } = await listOperatorQueues(includeTest);
  const visible = filterItems(items, { owner, userId: current.principal.userId, includeTest });
  // The header (shop, period) scopes the whole page; the toolbar narrows the list.
  const scoped = searchItems(visible, { shopId: search.shopId, sinceDays: search.sinceDays }, now);
  const found = sortItemsBy(searchItems(scoped, { q: search.q, status: search.status, ownerId: search.ownerId }, now), search.sort);
  const counts = Object.fromEntries(QUEUE_KINDS.map((k) => [k, found.filter((i) => i.kind === k).length])) as Record<QueueKind, number>;
  const inQueue = kind ? found.filter((i) => i.kind === kind) : found;
  // Ten per page: each card is tall, so twenty meant a lot of scrolling.
  const list = pageOf(inQueue, pageNumber(params.page), 10);
  const shown = list.items;
  const shops = [...new Map(visible.filter((i) => i.shopId).map((i) => [i.shopId!, i.shopName ?? "Unnamed shop"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const searching = search.q !== "" || search.status !== "all" || search.ownerId !== null;

  const href = (next: { kind?: QueueKind | null; owner?: OwnerFilter; test?: boolean; clearToolbar?: boolean }) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && value && !["page", "kind", "owner", "test"].includes(key) && !(next.clearToolbar && TOOLBAR_FIELDS.includes(key))) q.set(key, value);
    const k = next.kind === undefined ? kind : next.kind;
    if (k) q.set("kind", k);
    const o = next.owner ?? owner;
    if (o !== "all") q.set("owner", o);
    if (next.test ?? includeTest) q.set("test", "1");
    const s = q.toString();
    return s ? `/psg/operations?${s}` : "/psg/operations";
  };
  const exportHref = href({}).replace("/psg/operations", "/psg/operations/export");
  const scopeLabel = kind ? QUEUE_LABELS[kind] : "All queues";

  // Headline numbers, for the scoped page.
  const overdue = scoped.filter((i) => i.overdue);
  const unowned = scoped.filter((i) => !i.owner);
  const waits = scoped.map((i) => now.getTime() - i.since.getTime());
  const avgWait = waits.length ? duration(waits.reduce((t, w) => t + w, 0) / waits.length) : "0 min";
  const oldest = waits.length ? duration(Math.max(...waits)) : "0 min";
  const newThisWeek = (subset: { since: Date }[]) => subset.filter((i) => now.getTime() - i.since.getTime() < 7 * DAY).length;
  const ofKind = (k: QueueKind) => scoped.filter((i) => i.kind === k);
  const kpis: { label: string; value: string; note: string; icon: LucideIcon; tone: keyof typeof KPI_TONES; trend?: { since: Date }[]; kind?: QueueKind }[] = [
    { label: "Open items", value: String(scoped.length), note: `${newThisWeek(scoped)} new in the last 7 days`, icon: Inbox, tone: "blue", trend: scoped },
    { label: "Overdue", value: String(overdue.length), note: `${pct(overdue.length, scoped.length)}% of open items`, icon: AlertTriangle, tone: "red", trend: overdue },
    { label: "Avg. waiting time", value: avgWait, note: `Oldest waiting ${oldest}`, icon: Hourglass, tone: "indigo" },
    { label: "No owner", value: String(unowned.length), note: `${scoped.length - unowned.length} have an owner`, icon: UserX, tone: "green", trend: unowned },
    { label: "Held imports", value: String(ofKind("held_import").length), note: `${newThisWeek(ofKind("held_import"))} new in the last 7 days`, icon: FileUp, tone: "sky", kind: "held_import" },
    { label: "Email outcome unknown", value: String(ofKind("email_unknown").length), note: "Check the provider first", icon: MailQuestion, tone: "slate", kind: "email_unknown" },
  ];

  // Side panel.
  const buckets = ageBuckets(inQueue, now);
  const topBucket = Math.max(1, ...buckets);
  const owned = inQueue.filter((i) => i.owner).length;
  const activity = inQueue
    .flatMap((i) => i.history.map((h) => ({ item: i, h })))
    .sort((a, b) => b.h.at.getTime() - a.h.at.getTime())
    .slice(0, 4);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 xl:flex-nowrap">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">Operations</p>
          <h1 className="mt-1 text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Operator queues</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Everything that failed or is waiting for a person. Each item says why, how long it has waited and who owns it. Fix it on its own page and it leaves this list. Nothing here is retried or sent
            by itself.
          </p>
        </div>
        <LiveForm label="Scope" className="flex w-full shrink-0 flex-wrap items-end gap-2 sm:w-auto">
          <Keep params={params} except={HEADER_FIELDS} />
          <Field id="queue-shop" label="Shop">
            <select id="queue-shop" name="shop" defaultValue={search.shopId ?? ""} className={`${SELECT} w-56 max-w-full`}>
              <option value="">All shops</option>
              {shops.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="queue-since" label="Raised in">
            <select id="queue-since" name="since" defaultValue={search.sinceDays ? String(search.sinceDays) : ""} className={SELECT}>
              <option value="">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </Field>
          <noscript>
            <button type="submit" className="h-9 rounded-lg bg-brand-navy-900 px-3 text-xs font-medium text-white">
              Apply
            </button>
          </noscript>
        </LiveForm>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => {
          const t = KPI_TONES[k.tone];
          const body = (
            <>
              <span className="flex items-start justify-between gap-2">
                <span className={`rounded-xl p-2 ${t.icon}`} aria-hidden="true">
                  <k.icon className="size-5" />
                </span>
                {k.trend && <Sparkline id={`ops-${k.tone}`} values={openByDay(k.trend, now)} color={t.line} label={`${k.label}: open items day by day, last 30 days`} className="h-8 w-16" />}
              </span>
              <span className="mt-3 block text-xl font-semibold tabular-nums text-brand-navy-900">{k.value}</span>
              <span className="block text-xs font-medium text-gray-700">{k.label}</span>
              <span className="mt-1 block text-[11px] text-gray-500">{k.note}</span>
            </>
          );
          const cls = `flex min-w-0 flex-col rounded-2xl border p-4 shadow-sm ${t.card}`;
          return k.kind ? (
            <Link key={k.label} href={href({ kind: k.kind })} className={`${cls} transition hover:-translate-y-0.5 hover:shadow-md`}>
              {body}
            </Link>
          ) : (
            <div key={k.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* Queues */}
          <nav aria-label="Queues" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-1 border-b border-gray-200">
              <Tab href={href({ kind: null })} active={kind === null} label="All" count={found.length} />
              {QUEUE_KINDS.map((k) => (
                <Tab key={k} href={href({ kind: k })} active={kind === k} label={QUEUE_LABELS[k]} count={counts[k]} />
              ))}
            </div>
          </nav>

          {/* Toolbar */}
          <div className="flex flex-col gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end gap-2">
              <LiveForm label="Search and filter this queue" className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                <Keep params={params} except={TOOLBAR_FIELDS} />
                <label className="relative min-w-40 flex-1">
                  <span className="sr-only">Search this queue</span>
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
                  <input
                    name="q"
                    type="search"
                    defaultValue={search.q}
                    maxLength={100}
                    autoComplete="off"
                    placeholder="Search queue items, reasons or shops..."
                    className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:bg-white"
                  />
                </label>
                <Field id="queue-owner" label="Owner">
                  <select id="queue-owner" name="who" defaultValue={search.ownerId ?? ""} className={SELECT}>
                    <option value="">All owners</option>
                    {operators.map((o) => (
                      <option key={o.userId} value={o.userId}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field id="queue-status" label="Status">
                  <select id="queue-status" name="status" defaultValue={search.status === "all" ? "" : search.status} className={SELECT}>
                    <option value="">All</option>
                    <option value="overdue">Overdue</option>
                    <option value="on_time">Not overdue</option>
                  </select>
                </Field>
                <Field id="queue-sort" label="Sort by">
                  <select id="queue-sort" name="sort" defaultValue={search.sort === "overdue" ? "" : search.sort} className={SELECT}>
                    <option value="">Overdue first</option>
                    <option value="oldest">Waiting time (oldest)</option>
                    <option value="newest">Waiting time (newest)</option>
                  </select>
                </Field>
              </LiveForm>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div role="group" aria-label="Owner" className="flex gap-1.5">
                {OWNER_FILTERS.map((f) => (
                  <Link
                    key={f.key}
                    href={href({ owner: f.key })}
                    aria-current={owner === f.key ? "true" : undefined}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${owner === f.key ? "border-brand-navy-900 bg-brand-navy-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"}`}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
              <Link href={href({ test: !includeTest })} role="switch" aria-checked={!includeTest} className="flex items-center gap-2 text-xs font-medium text-gray-700">
                <span className={`relative h-5 w-9 rounded-full transition ${includeTest ? "bg-gray-300" : "bg-indigo-600"}`} aria-hidden="true">
                  <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${includeTest ? "left-0.5" : "left-[18px]"}`} />
                </span>
                Hide test data
              </Link>
              {/* A plain link: client-side navigation would try to render the CSV as a page. */}
              <a href={exportHref} download className="ml-auto flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-800">
                <Download aria-hidden="true" className="size-4" />
                Export CSV
              </a>
            </div>
          </div>

          <p className="max-w-3xl text-sm text-gray-600">
            {kind ? QUEUE_HELP[kind] : `Overdue items come first, then the ones waiting longest. A suppression change is overdue ${SUPPRESSION_OVERDUE_HOURS} hours after it was raised.`}
            {searching && (
              <>
                {" "}
                <span className="font-medium text-gray-800">
                  {inQueue.length} {inQueue.length === 1 ? "item matches" : "items match"} your search.
                </span>{" "}
                <Link href={href({ clearToolbar: true })} className="text-indigo-600 hover:underline">
                  Clear search
                </Link>
              </>
            )}
          </p>

          {/* Items */}
          <ul className="flex flex-col gap-3">
            {shown.length === 0 && <li className="rounded-2xl border border-gray-200 bg-white px-4 py-10 text-center text-sm text-gray-500">{searching ? "Nothing here matches your search." : "Nothing is waiting here."}</li>}
            {shown.map((item) => {
              const style = KIND_STYLE[item.kind];
              const waited = days(now.getTime() - item.since.getTime());
              return (
                <li
                  key={item.key}
                  className="relative rounded-2xl border border-gray-200/80 bg-white py-4 pl-6 pr-4 shadow-sm"
                  style={{ boxShadow: `inset 4px 0 0 ${item.overdue ? "#ef4444" : style.color}` }}
                >
                  <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem_12rem]">
                    <div className="min-w-0 pr-8 md:pr-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className={`rounded-md px-2 py-0.5 font-medium ${style.chip}`}>{QUEUE_LABELS[item.kind]}</span>
                        {item.overdue && <span className="rounded-md bg-rose-50 px-2 py-0.5 font-medium text-rose-700">Overdue</span>}
                        {item.isTest && <span className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-800">Test</span>}
                      </div>
                      <h2 className="mt-2 text-[15px] font-semibold text-brand-navy-900">{item.title}</h2>
                      <p className="text-xs text-gray-600">{item.shopName ?? (item.subjectType.startsWith("worker") ? "All shops" : "Shop not confirmed")}</p>
                      <p className="mt-1.5 text-xs text-gray-700">
                        <span className="font-semibold">Why: </span>
                        {item.reason}
                      </p>
                      {item.provenance && <p className="mt-0.5 break-words text-[11px] text-gray-500">{item.provenance}</p>}
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer font-medium text-brand-navy-900">History ({item.history.length})</summary>
                        {item.history.length === 0 ? (
                          <p className="mt-2 text-gray-500">No recorded changes yet.</p>
                        ) : (
                          <ol className="mt-2 flex flex-col gap-1.5 border-l border-gray-200 pl-3">
                            {item.history.map((h, i) => (
                              <li key={i}>
                                <span className="text-gray-500">{dateTime.format(h.at)}</span> <span className="font-medium text-gray-800">{historyLabel(h.action)}</span>{" "}
                                <span className="text-gray-600">by {h.actorName ?? (h.actorType === "respondent" ? "the customer" : "the system")}</span>
                                {h.detail && <span className="block break-words text-gray-600">{h.detail}</span>}
                              </li>
                            ))}
                          </ol>
                        )}
                      </details>
                    </div>

                    <div className="flex flex-wrap items-baseline gap-x-2 md:block">
                      <p className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock aria-hidden="true" className="size-3.5" />
                        Waiting for
                      </p>
                      <p className={`text-xl font-semibold tabular-nums ${item.overdue ? "text-rose-600" : waited >= 30 ? "text-orange-600" : "text-brand-navy-900"}`}>{age(item.since, now)}</p>
                      <p className="text-[11px] text-gray-500">since {dateTime.format(item.since)}</p>
                    </div>

                    <div className="flex flex-wrap items-start gap-3 md:flex-col md:gap-2">
                      <OwnerControl
                        stacked
                        subjectType={item.subjectType}
                        subjectId={item.subjectId}
                        revision={item.revision}
                        ownerUserId={item.owner?.userId ?? null}
                        operators={operators}
                        currentUserId={current.principal.userId}
                        itemTitle={item.title}
                      />
                      <div className="flex w-full items-center">
                        {item.href ? (
                          <Link href={item.href} className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-red px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-red-dark">
                            {item.hrefLabel}
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                          </Link>
                        ) : (
                          item.subjectType === "worker" && <p className="max-w-40 text-xs text-gray-700">Restart the worker process, then reload this page.</p>
                        )}
                        <details className="absolute right-3 top-3">
                          <summary aria-label={`More for ${item.title}`} className="flex size-8 cursor-pointer list-none items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
                            <MoreHorizontal aria-hidden="true" className="size-4" />
                          </summary>
                          <div className="absolute right-0 top-9 z-10 flex w-56 flex-col rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg">
                            <Link href={href({ kind: item.kind })} className="px-4 py-2 text-gray-700 hover:bg-gray-50">
                              Show only {QUEUE_LABELS[item.kind].toLowerCase()}
                            </Link>
                            {item.shopId && (
                              <Link href={`/psg/shops/${item.shopId}`} className="px-4 py-2 text-gray-700 hover:bg-gray-50">
                                Open shop
                              </Link>
                            )}
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>
                  {(item.subjectType === "worker_job" || item.subjectType === "import_row") && canReview && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      <ReviewForm subjectType={item.subjectType} subjectId={item.subjectId} revision={item.revision} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pagination {...list} path="/psg/operations" query={params} label="Operator queue pages" />
        </div>

        {/* Side panel. Plain divs, not list items, so an item's title here never doubles its card for assistive tech. */}
        <aside aria-label="Queue summary" className="flex min-w-0 flex-col gap-4">
          <Panel title="Queue overview">
            {scoped.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing open.</p>
            ) : (
              <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col">
                <Donut total={scoped.length} caption="Open items" size="size-28" thickness={6} parts={QUEUE_KINDS.map((k) => ({ label: QUEUE_LABELS[k], value: ofKind(k).length, color: KIND_STYLE[k].color }))} />
                <div className="flex w-full min-w-0 flex-col gap-1.5 text-xs">
                  {QUEUE_KINDS.map((k) => (
                    <p key={k} className="flex items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: KIND_STYLE[k].color }} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-gray-600">{QUEUE_LABELS[k]}</span>
                      <span className="font-semibold tabular-nums text-brand-navy-900">{ofKind(k).length}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Aging buckets" note={scopeLabel}>
            <div className="flex flex-col gap-2">
              {AGE_BUCKETS.map((b, i) => (
                <div key={b.label} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs">
                  <span className="text-gray-600">{b.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                    <span className="block h-full rounded-full" style={{ width: `${(buckets[i] / topBucket) * 100}%`, background: AGE_COLORS[i] }} />
                  </span>
                  <span className="text-right font-semibold tabular-nums text-brand-navy-900">{buckets[i]}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Queue health" note={scopeLabel}>
            <div className="grid grid-cols-2 gap-2">
              <HealthTile icon={Hourglass} tone="bg-indigo-50 text-indigo-600" label="Oldest" value={inQueue.length ? age(inQueue.reduce((o, i) => (i.since < o ? i.since : o), inQueue[0].since), now) : "–"} />
              <HealthTile
                icon={Clock}
                tone="bg-emerald-50 text-emerald-600"
                label="Avg. wait"
                value={inQueue.length ? duration(inQueue.reduce((t, i) => t + now.getTime() - i.since.getTime(), 0) / inQueue.length) : "–"}
              />
              <HealthTile icon={UserCheck} tone="bg-sky-50 text-sky-600" label="Owned" value={`${pct(owned, inQueue.length)}%`} />
              <HealthTile icon={AlertTriangle} tone="bg-rose-50 text-rose-600" label="Overdue" value={`${pct(inQueue.filter((i) => i.overdue).length, inQueue.length)}%`} />
            </div>
          </Panel>

          <Panel title="Recent activity" note={scopeLabel}>
            {activity.length === 0 ? (
              <p className="text-sm text-gray-500">No changes recorded yet.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {activity.map(({ item, h }, i) => (
                  <div key={`${item.key}-${i}`} className="flex items-start gap-3">
                    <span className="rounded-full bg-indigo-50 p-1.5 text-indigo-600" aria-hidden="true">
                      <Activity className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-brand-navy-900">{historyLabel(h.action)}</p>
                      <p className="truncate text-[11px] text-gray-500">{item.title}</p>
                      <p className="text-[11px] text-gray-500">
                        {h.actorName ?? (h.actorType === "respondent" ? "Customer" : "System")} · {ago(h.at, now)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

const SELECT = "h-9 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800 outline-none transition focus:border-indigo-400";

const KPI_TONES = {
  blue: { card: "bg-linear-to-br from-blue-50 to-white border-blue-100", icon: "bg-blue-100 text-blue-600", line: "#4f7cf7" },
  red: { card: "bg-linear-to-br from-rose-50 to-white border-rose-100", icon: "bg-rose-100 text-rose-600", line: "#f43f5e" },
  indigo: { card: "bg-linear-to-br from-indigo-50 to-white border-indigo-100", icon: "bg-indigo-100 text-indigo-600", line: "#6366f1" },
  green: { card: "bg-linear-to-br from-emerald-50 to-white border-emerald-100", icon: "bg-emerald-100 text-emerald-600", line: "#10b981" },
  sky: { card: "bg-white border-gray-200/80", icon: "bg-sky-100 text-sky-600", line: "#0ea5e9" },
  slate: { card: "bg-white border-gray-200/80", icon: "bg-slate-100 text-slate-600", line: "#64748b" },
};

function Tab({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-mb-px whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[13px] transition ${active ? "border-indigo-600 font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
    >
      {label} <span className={active ? "text-indigo-600" : "text-gray-500"}>({count})</span>
    </Link>
  );
}

/** A label above its control, tied by id so the name is just the label (not the chosen option too). */
function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-gray-500">
        {label}
      </label>
      {children}
    </div>
  );
}

/** The other filters as hidden fields, so a submit without JavaScript keeps them. */
function Keep({ params, except }: { params: Record<string, string | string[] | undefined>; except: string[] }) {
  return (
    <>
      {Object.entries(params).map(([key, value]) =>
        typeof value === "string" && value && key !== "page" && !except.includes(key) ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
    </>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-brand-navy-900">
        {title} {note && <span className="text-xs font-normal text-gray-500">({note})</span>}
      </h2>
      {children}
    </section>
  );
}

function HealthTile({ icon: Icon, tone, label, value }: { icon: LucideIcon; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-gray-50 p-2.5">
      <span className={`rounded-lg p-1.5 ${tone}`} aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] text-gray-500">{label}</span>
        <span className="block truncate text-sm font-semibold tabular-nums text-brand-navy-900">{value}</span>
      </span>
    </div>
  );
}
