import { Ban, CheckCircle2, Clock, FileText, Hourglass, Inbox, PauseCircle, RefreshCw, Search, Send, Store, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LiveForm } from "@/components/live-form";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { STOP_LABELS } from "@/modules/email-ledger/policy";
import { REASON_LABELS } from "@/modules/imports/eligibility";
import { listInvitationQueue } from "@/modules/invitations/invitations";
import { QUEUE_LABELS, type QueueView } from "@/modules/invitations/store";
import { MODE_LABELS } from "@/modules/shops/fields";
import { listShopModes, shopSurveyVersion } from "@/modules/shops/settings";
import { listVisibleShops } from "@/modules/shops/shops";
import { QueueTable } from "./queue-table";
import { ShopPicker } from "./shop-picker";

export const metadata: Metadata = { title: "Invitations" };

const VIEWS = Object.keys(QUEUE_LABELS) as QueueView[];
const DAY = 86_400_000;

const VIEW_HELP: Record<QueueView, string> = {
  ready: "Eligible right now and not yet sent. Select the ones to send.",
  waiting: "Eligible except that the shop is not Live. They are not sent when the shop goes Live: you select them here.",
  held: "Something is missing or unclear, or an email is on hold. Fix details and send, or release held emails from Email review.",
  excluded: "Never sent: already surveyed in the legacy system, opted out, or the survey was already completed.",
  sent: "An invitation email has been queued or sent.",
};

const VIEW_TILES: Record<QueueView, { icon: LucideIcon; tone: string; note: string; empty: string }> = {
  ready: { icon: Send, tone: "bg-blue-50 text-blue-600", note: "Eligible right now", empty: "Nothing is ready to send right now." },
  waiting: { icon: Hourglass, tone: "bg-amber-50 text-amber-600", note: "Eligible once the shop is Live", empty: "Nothing is waiting for Live." },
  held: { icon: PauseCircle, tone: "bg-rose-50 text-rose-600", note: "Something to fix first", empty: "Nothing is held." },
  excluded: { icon: Ban, tone: "bg-violet-50 text-violet-600", note: "Never sent", empty: "Nothing is excluded." },
  sent: { icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600", note: "Invitations already sent", empty: "No invitations sent yet." },
};

const MODE_STYLE: Record<string, string> = { test: "bg-amber-100 text-amber-800", live: "bg-emerald-100 text-emerald-800", paused: "bg-gray-200 text-gray-800" };
const MODE_NOTE: Record<string, string> = {
  test: "Test mode: only internal test recipients can receive an invitation. Review each visit and its status in the tabs below.",
  live: "Live: selected invitations go to customers. Nothing is sent until you select and confirm it.",
  paused: "Paused: new invitations are not sent until the shop is Live again.",
};

function zoneName(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone;
  }
}

export default async function InvitationsPage({ searchParams }: PageProps<"/psg/invitations">) {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "import.manage");
  const query = await searchParams;
  const { shop: requestedShop, view: requestedView } = query;
  const [shops, modes] = await Promise.all([listVisibleShops(), listShopModes()]);
  const shop = shops.find((s) => s.id === requestedShop) ?? shops[0];
  const view = VIEWS.includes(requestedView as QueueView) ? (requestedView as QueueView) : "ready";
  const [queue, version] = shop ? await Promise.all([listInvitationQueue(shop.id), shopSurveyVersion(shop.id)]) : [[], null];
  const mode = shop ? (modes.get(shop.id) ?? "test") : "test";

  // Search and delivery-date filter, within the chosen shop's queue.
  const q = (typeof query.q === "string" ? query.q : "").trim().toLowerCase().slice(0, 100);
  const since = [7, 30, 90].find((n) => String(n) === query.since) ?? null;
  const now = new Date().getTime();
  const matches = (r: (typeof queue)[number]) =>
    (!q || [r.customerName, r.sourceVisitKey, r.email ?? ""].some((v) => v.toLowerCase().includes(q))) && (!since || (r.deliveredOn !== null && now - Date.parse(`${r.deliveredOn}T00:00:00Z`) <= since * DAY));
  const filtered = queue.filter(matches);
  const searching = Boolean(q || since);

  const counts = Object.fromEntries(VIEWS.map((v) => [v, filtered.filter((r) => r.view === v).length])) as Record<QueueView, number>;
  const list = pageOf(
    filtered.filter((r) => r.view === view),
    pageNumber(query.page),
  );
  const items = list.items.map((r) => ({
    id: r.id,
    visitId: r.visitId,
    revision: r.revision,
    isTest: r.isTest,
    sourceVisitKey: r.sourceVisitKey,
    customerName: r.customerName,
    email: r.email,
    deliveredOn: r.deliveredOn,
    deliveredOnRaw: r.deliveredOnRaw,
    reasons: r.blockers.map((b) => REASON_LABELS[b]),
    printable: !r.intentState && r.blockers.every((b) => b === "EMAIL_NEEDED" || b === "TEST_RECIPIENT_NOT_ALLOWED"),
    intentState: r.intentState,
    intentReason: r.intentReason ? (REASON_LABELS[r.intentReason as keyof typeof REASON_LABELS] ?? STOP_LABELS[r.intentReason] ?? r.intentReason) : null,
  }));
  const tabHref = (v: QueueView) => {
    const p = new URLSearchParams({ shop: shop?.id ?? "", view: v });
    if (q) p.set("q", q);
    if (since) p.set("since", String(since));
    return `/psg/invitations?${p}`;
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Invitations</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">Imported repair visits and whether each can be surveyed. Nothing here sends by itself.</p>
      </div>

      {shops.length === 0 ? (
        <p className="text-sm text-gray-600">Create a shop first.</p>
      ) : (
        <>
          <div>
            <ShopPicker key={shop?.id} shops={shops.map((s) => ({ id: s.id, name: s.name }))} shopId={shop?.id ?? ""} view={view} />
            {shop && (
              <p className="mt-2 text-sm text-gray-600">
                {shop.name} is in <span className="font-medium text-gray-900">{MODE_LABELS[mode]}</span> mode.{" "}
                <Link href={`/psg/shops/${shop.id}`} className="font-medium text-indigo-600 underline-offset-2 hover:underline">
                  Shop settings
                </Link>
              </p>
            )}
          </div>

          {shop && (
            <section aria-label="Shop details" className="grid grid-cols-1 gap-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-0 md:divide-x md:divide-gray-100">
              <div className="flex items-start gap-4 md:pr-6">
                <span className="rounded-full bg-indigo-50 p-3.5 text-indigo-600" aria-hidden="true">
                  <Store className="size-6" />
                </span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-brand-navy-900">{shop.name}</span>
                    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${MODE_STYLE[mode]}`}>{MODE_LABELS[mode]} mode</span>
                  </p>
                  <p className="mt-1 text-sm text-gray-600">{MODE_NOTE[mode]}</p>
                </div>
              </div>
              <Fact icon={Clock} label="Time zone" value={zoneName(shop.timezone)} />
              <Fact icon={FileText} label="Survey version" value={version ? `${version.instrumentName} v${version.version}${version.isTest ? " (TEST)" : ""}` : "None assigned"} />
            </section>
          )}

          {/* Counts per queue; the tabs below open each one. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {VIEWS.map((v) => {
              const t = VIEW_TILES[v];
              return (
                <div key={v} className={`flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm ${v === view ? "border-indigo-200 ring-2 ring-indigo-500/20" : "border-gray-200/80"}`}>
                  <span className={`rounded-xl p-2.5 ${t.tone}`} aria-hidden="true">
                    <t.icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-600">{QUEUE_LABELS[v]}</p>
                    <p className="text-xl font-semibold tabular-nums text-brand-navy-900">{counts[v]}</p>
                    <p className="truncate text-[11px] text-gray-500">{t.note}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <nav aria-label="Queue" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="flex min-w-max gap-1 border-b border-gray-200">
              {VIEWS.map((v) => (
                <Link
                  key={v}
                  href={tabHref(v)}
                  aria-current={v === view ? "page" : undefined}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${v === view ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
                >
                  {QUEUE_LABELS[v]} <span className="text-gray-500">({counts[v]})</span>
                </Link>
              ))}
            </div>
          </nav>

          <LiveForm label="Find visits" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="shop" value={shop?.id ?? ""} />
            <input type="hidden" name="view" value={view} />
            <div className="relative min-w-48 flex-1">
              <label htmlFor="invitation-search" className="sr-only">
                Search visits
              </label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" />
              <input
                id="invitation-search"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={100}
                autoComplete="off"
                placeholder="Search by name, visit ID or email..."
                className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-indigo-400"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="invitation-since" className="sr-only">
                Delivered
              </label>
              <select id="invitation-since" name="since" defaultValue={since ? String(since) : ""} className="h-10 min-w-40 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-gray-800">
                <option value="">Any delivery date</option>
                <option value="7">Delivered in the last 7 days</option>
                <option value="30">Delivered in the last 30 days</option>
                <option value="90">Delivered in the last 90 days</option>
              </select>
            </div>
            {searching && (
              <Link href={tabHref(view).replace(/&(q|since)=[^&]*/g, "")} className="flex h-10 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                Clear filters
              </Link>
            )}
            <noscript>
              <button type="submit" className="h-10 rounded-lg bg-brand-navy-900 px-3 text-sm text-white">
                Apply
              </button>
            </noscript>
          </LiveForm>
          <p className="-mt-2 text-xs text-gray-500">{VIEW_HELP[view]}</p>

          {shop &&
            (items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200/80 bg-white px-6 py-12 text-center shadow-sm">
                <span className="rounded-full bg-indigo-50 p-4 text-indigo-500" aria-hidden="true">
                  <Inbox className="size-8" />
                </span>
                <p className="text-base font-semibold text-brand-navy-900">{searching ? "No visits match these filters." : VIEW_TILES[view].empty}</p>
                <p className="text-sm text-gray-500">{searching ? "Try another name or date range." : "When visits reach this queue, they appear here for you to review."}</p>
                <Link href={tabHref(view)} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100">
                  <RefreshCw aria-hidden="true" className="size-4" />
                  Refresh
                </Link>
              </div>
            ) : (
              <QueueTable key={`${shop.id}-${view}-${list.page}-${q}-${since}`} shopId={shop.id} items={items} selectable={view === "ready"} canManage={canManage} />
            ))}
          <Pagination {...list} path="/psg/invitations" query={query} label="Invitation pages" />
        </>
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 md:px-6">
      <span className="rounded-full bg-gray-100 p-2.5 text-gray-600" aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-sm font-medium text-gray-900">{value}</p>
      </div>
    </div>
  );
}
