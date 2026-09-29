import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageRequireShopRead } from "@/modules/access/page-guards";
import { getShopCase } from "@/modules/cases/cases";
import { RESOLUTION_OUTCOMES } from "@/modules/cases/store";
import { ShopCasePanel } from "./case-panel";

export const metadata: Metadata = { title: "Follow-up" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const FOLLOW_UP_LABELS: Record<string, string> = { open: "Open", closure_requested: "Closure requested: waiting for PSG", resolved: "Resolved by PSG", none: "Open" };

/** One follow-up case for the shop. PSG-only notes are not included (SR-34, P-07). */
export default async function ShopCasePage({ params }: PageProps<"/shop/[shopId]/cases/[caseId]">) {
  const { shopId, caseId } = await params;
  await pageRequireShopRead(shopId);
  const data = await getShopCase(shopId, caseId);
  if (!data) notFound();
  const { case: c } = data;

  return (
    <div className="max-w-4xl">
      <Link href={`/shop/${shopId}/cases`} className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Follow-up
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-brand-navy-900">Customer feedback to follow up</h1>
      <p className="mt-1 text-sm text-gray-600">
        Status: <span className="font-medium text-gray-900">{FOLLOW_UP_LABELS[c.followUp]}</span> ·{" "}
        <Link href={`/shop/${shopId}/responses/${c.responseId}`} className="text-brand-navy-900 underline-offset-2 hover:underline">
          Read the customer&apos;s answers
        </Link>
      </p>
      {c.status === "pending_review" && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">PSG is reviewing a corrected answer on this response. Your notes and history stay here.</p>}

      <section aria-labelledby="attention" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 id="attention" className="text-base font-semibold text-brand-navy-900">
          What needs attention
        </h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
          {(c.alerts as { id: string; label: string }[]).map((a) => (
            <li key={a.id}>{a.label}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="notes" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 id="notes" className="text-base font-semibold text-brand-navy-900">
          Notes
        </h2>
        {data.notes.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No notes yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {data.notes.map(({ note, authorName }) => (
              <li key={note.id} className="border-l-2 border-gray-200 pl-3 text-sm">
                <p className="text-xs text-gray-500">
                  {dateTime.format(note.createdAt)} · {authorName ?? "System"} ({note.authorKind === "shop" ? "your shop" : "PSG"})
                </p>
                <p className="whitespace-pre-wrap text-gray-900">{note.body}</p>
              </li>
            ))}
          </ol>
        )}
        {c.followUp === "resolved" && (
          <p className="mt-4 text-sm text-gray-800">
            PSG resolved this {c.resolvedAt ? `on ${dateTime.format(c.resolvedAt)}` : ""}: {RESOLUTION_OUTCOMES[c.resolutionOutcome as keyof typeof RESOLUTION_OUTCOMES] ?? c.resolutionOutcome}.
          </p>
        )}
        <div className="mt-4">
          <ShopCasePanel shopId={shopId} caseId={c.id} revision={c.revision} followUp={c.followUp} />
        </div>
      </section>
    </div>
  );
}
