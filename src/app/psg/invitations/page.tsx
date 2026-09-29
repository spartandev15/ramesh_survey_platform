import type { Metadata } from "next";
import Link from "next/link";
import { hasCapability } from "@/modules/access/capabilities";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { STOP_LABELS } from "@/modules/email-ledger/policy";
import { REASON_LABELS } from "@/modules/imports/eligibility";
import { listInvitationQueue } from "@/modules/invitations/invitations";
import { QUEUE_LABELS, type QueueView } from "@/modules/invitations/store";
import { MODE_LABELS } from "@/modules/shops/fields";
import { listShopModes } from "@/modules/shops/settings";
import { listVisibleShops } from "@/modules/shops/shops";
import { QueueTable } from "./queue-table";
import { ShopPicker } from "./shop-picker";

export const metadata: Metadata = { title: "Invitations" };

const VIEWS = Object.keys(QUEUE_LABELS) as QueueView[];

const VIEW_HELP: Record<QueueView, string> = {
  ready: "Eligible right now and not yet sent. Select the ones to send.",
  waiting: "Eligible except that the shop is not Live. They are not sent when the shop goes Live: you select them here.",
  held: "Something is missing or unclear, or an email is on hold. Fix details and send, or release held emails from Email review.",
  excluded: "Never sent: already surveyed in the legacy system, opted out, or the survey was already completed.",
  sent: "An invitation email has been queued or sent.",
};

export default async function InvitationsPage({ searchParams }: PageProps<"/psg/invitations">) {
  const current = await pageRequireCapability("psg.workspace");
  const canManage = hasCapability(current.principal, "import.manage");
  const query = await searchParams;
  const { shop: requestedShop, view: requestedView } = query;
  const [shops, modes] = await Promise.all([listVisibleShops(), listShopModes()]);
  const shop = shops.find((s) => s.id === requestedShop) ?? shops[0];
  const view = VIEWS.includes(requestedView as QueueView) ? (requestedView as QueueView) : "ready";
  const queue = shop ? await listInvitationQueue(shop.id) : [];
  const mode = shop ? (modes.get(shop.id) ?? "test") : "test";

  const counts = Object.fromEntries(VIEWS.map((v) => [v, queue.filter((r) => r.view === v).length])) as Record<QueueView, number>;
  const list = pageOf(
    queue.filter((r) => r.view === view),
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

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Invitations</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">Imported repair visits and whether each can be surveyed. Nothing here sends by itself.</p>

      {shops.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">Create a shop first.</p>
      ) : (
        <>
          <div className="mt-6">
            <ShopPicker key={shop?.id} shops={shops.map((s) => ({ id: s.id, name: s.name }))} shopId={shop?.id ?? ""} view={view} />
          </div>
          {shop && (
            <p className="mt-3 text-sm text-gray-600">
              {shop.name} is in <span className="font-medium text-gray-900">{MODE_LABELS[mode]}</span> mode.{" "}
              <Link href={`/psg/shops/${shop.id}`} className="text-brand-navy-900 underline-offset-2 hover:underline">
                Shop settings
              </Link>
            </p>
          )}

          <nav aria-label="Queue" className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
            {VIEWS.map((v) => (
              <Link
                key={v}
                href={`/psg/invitations?shop=${shop?.id}&view=${v}`}
                aria-current={v === view ? "page" : undefined}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${v === view ? "border-brand-red font-medium text-brand-navy-900" : "border-transparent text-gray-600 hover:text-brand-navy-900"}`}
              >
                {QUEUE_LABELS[v]} <span className="text-gray-500">({counts[v]})</span>
              </Link>
            ))}
          </nav>
          <p className="mt-3 text-sm text-gray-600">{VIEW_HELP[view]}</p>
          <div className="mt-3">{shop && <QueueTable key={`${shop.id}-${view}-${list.page}`} shopId={shop.id} items={items} selectable={view === "ready"} canManage={canManage} />}</div>
          <Pagination {...list} path="/psg/invitations" query={query} label="Invitation pages" />
        </>
      )}
    </div>
  );
}
