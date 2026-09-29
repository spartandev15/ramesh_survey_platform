import type { Metadata } from "next";
import Link from "next/link";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { listOperatorQueues } from "@/modules/operations/operations";
import { filterItems, historyLabel, QUEUE_HELP, QUEUE_KINDS, QUEUE_LABELS, sortItems, SUPPRESSION_OVERDUE_HOURS, type OwnerFilter, type QueueKind } from "@/modules/operations/policy";
import { OwnerControl, ReviewForm } from "./controls";

export const metadata: Metadata = { title: "Operator queues" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const OWNER_FILTERS: { key: OwnerFilter; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "mine", label: "Mine" },
  { key: "unassigned", label: "No owner" },
];

function age(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

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
  const now = new Date();

  const { items, operators } = await listOperatorQueues(includeTest);
  const visible = sortItems(filterItems(items, { owner, userId: current.principal.userId, includeTest }));
  const counts = Object.fromEntries(QUEUE_KINDS.map((k) => [k, visible.filter((i) => i.kind === k).length])) as Record<QueueKind, number>;
  const list = pageOf(kind ? visible.filter((i) => i.kind === kind) : visible, pageNumber(params.page));
  const shown = list.items;
  const overdue = visible.filter((i) => i.overdue).length;

  const href = (next: { kind?: QueueKind | null; owner?: OwnerFilter; test?: boolean }) => {
    const q = new URLSearchParams();
    const k = next.kind === undefined ? kind : next.kind;
    if (k) q.set("kind", k);
    const o = next.owner ?? owner;
    if (o !== "all") q.set("owner", o);
    if (next.test ?? includeTest) q.set("test", "1");
    const s = q.toString();
    return s ? `/psg/operations?${s}` : "/psg/operations";
  };

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Operator queues</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">
        Everything that failed or is waiting for a person. Each item says why, how long it has waited and who owns it. Fix it on its own page and it leaves this list. Nothing here is retried or sent by
        itself.
      </p>
      <p className="mt-2 text-sm text-gray-900">
        {visible.length} open item{visible.length === 1 ? "" : "s"}
        {overdue > 0 && <span className="font-medium text-brand-red-dark">, {overdue} overdue</span>}
      </p>

      <nav aria-label="Queues" className="mt-5 flex flex-wrap gap-1 border-b border-gray-200">
        <Link
          href={href({ kind: null })}
          aria-current={kind === null ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${kind === null ? "border-brand-red font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
        >
          All <span className="text-gray-500">({visible.length})</span>
        </Link>
        {QUEUE_KINDS.map((k) => (
          <Link
            key={k}
            href={href({ kind: k })}
            aria-current={kind === k ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${kind === k ? "border-brand-red font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
          >
            {QUEUE_LABELS[k]} <span className="text-gray-500">({counts[k]})</span>
          </Link>
        ))}
      </nav>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div role="group" aria-label="Owner" className="flex flex-wrap gap-1">
          {OWNER_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href({ owner: f.key })}
              aria-current={owner === f.key ? "true" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${owner === f.key ? "border-brand-navy-900 bg-brand-navy-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-brand-navy-700"}`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <Link href={href({ test: !includeTest })} className="text-xs text-brand-navy-900 underline-offset-2 hover:underline">
          {includeTest ? "Hide test data" : "Include test data"}
        </Link>
      </div>
      <p className="mt-3 max-w-3xl text-sm text-gray-600">
        {kind ? QUEUE_HELP[kind] : `Overdue items come first, then the ones waiting longest. A suppression change is overdue ${SUPPRESSION_OVERDUE_HOURS} hours after it was raised.`}
      </p>

      <ul className="mt-4 flex flex-col gap-3">
        {shown.length === 0 && <li className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">Nothing is waiting here.</li>}
        {shown.map((item) => (
          <li key={item.key} className={`rounded-xl border bg-white p-4 ${item.overdue ? "border-brand-red/60" : "border-gray-200"}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700">{QUEUE_LABELS[item.kind]}</span>
              {item.overdue && <span className="rounded-full bg-brand-red/10 px-2 py-0.5 font-medium text-brand-red-dark">Overdue</span>}
              {item.isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">Test</span>}
              <span className="text-gray-600">
                Waiting {age(item.since, now)} <span className="text-gray-500">since {dateTime.format(item.since)}</span>
              </span>
            </div>
            <h2 className="mt-2 text-sm font-semibold text-gray-900">{item.title}</h2>
            <p className="text-xs text-gray-600">{item.shopName ?? (item.subjectType.startsWith("worker") ? "All shops" : "Shop not confirmed")}</p>
            <p className="mt-2 text-sm text-gray-800">
              <span className="font-medium">Why: </span>
              {item.reason}
            </p>
            {item.provenance && <p className="mt-1 break-words text-xs text-gray-600">{item.provenance}</p>}

            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <OwnerControl
                subjectType={item.subjectType}
                subjectId={item.subjectId}
                revision={item.revision}
                ownerUserId={item.owner?.userId ?? null}
                operators={operators}
                currentUserId={current.principal.userId}
                itemTitle={item.title}
              />
              {item.href && (
                <Link href={item.href} className="rounded-lg bg-brand-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-red-dark">
                  {item.hrefLabel}
                </Link>
              )}
              {item.subjectType === "worker" && <p className="text-xs text-gray-700">Restart the worker process, then reload this page.</p>}
            </div>
            {item.subjectType === "worker_job" && canReview && (
              <div className="mt-3">
                <ReviewForm jobId={item.subjectId} revision={item.revision} />
              </div>
            )}

            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-brand-navy-900">History ({item.history.length})</summary>
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
          </li>
        ))}
      </ul>
      <Pagination {...list} path="/psg/operations" query={params} label="Operator queue pages" />
    </div>
  );
}
