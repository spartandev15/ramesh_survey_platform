import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { getCase } from "@/modules/cases/cases";
import { RESOLUTION_OUTCOMES } from "@/modules/cases/store";
import { NoteForm, ResolvePanel, ReviewPanel } from "./panels";

export const metadata: Metadata = { title: "Alert case" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const STATUS_LABELS: Record<string, string> = { pending_review: "Waiting for PSG review", approved: "Approved", dismissed: "Dismissed" };
const FOLLOW_UP_LABELS: Record<string, string> = { none: "Not started", open: "Open", closure_requested: "Shop requested closure", resolved: "Resolved" };
const DELIVERY_LABELS: Record<string, string> = {
  queued: "Queued",
  sending: "Sending",
  accepted: "Accepted by the email provider",
  delivered: "Delivered",
  bounced: "Bounced",
  failed: "Failed",
  acceptance_unknown: "Outcome unknown (see Email review)",
  cancelled: "Not sent",
  held: "On hold",
};

/**
 * One negative-feedback case (SR-32..SR-34). Result visibility, approval,
 * email delivery and resolution are shown as separate facts (PDF 03 section 6).
 */
export default async function AlertCasePage({ params }: PageProps<"/psg/alerts/[caseId]">) {
  const current = await pageRequireCapability("psg.workspace");
  const { caseId } = await params;
  const data = await getCase(caseId);
  if (!data) notFound();
  const { case: c, response } = data;
  const alerts = c.alerts as { id: string; label: string }[];
  const canReview = hasCapability(current.principal, "alert.review");
  const canResolve = hasCapability(current.principal, "case.resolve");
  const delivered = data.deliveries.filter((d) => d.state === "accepted" || d.state === "delivered").length;

  return (
    <div className="max-w-5xl">
      <Link href="/psg/alerts" className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Alert review
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-brand-navy-900">Negative feedback</h1>
        {c.isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Test data</span>}
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {data.shopName ?? "Shop not confirmed"} · raised {dateTime.format(c.createdAt)} ·{" "}
        <Link href={`/psg/responses/${response.id}`} className="text-brand-navy-900 underline-offset-2 hover:underline">
          Open the response
        </Link>
        {data.visitKey ? ` (visit ${data.visitKey})` : " (not matched to a visit yet)"}
      </p>

      {c.outcomeChangedAt && (
        <p role="status" className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The answers were corrected on {dateTime.format(c.outcomeChangedAt)} after this case was reviewed. The alerts below are the corrected ones. Nothing was re-sent: approve again only if outreach is still right.
        </p>
      )}

      <section aria-label="Case status" className="mt-4 grid gap-3 sm:grid-cols-4">
        <Fact label="Result visible to the shop" value={data.shopName ? "Yes, since it was submitted" : "No: shop not confirmed"} />
        <Fact label="PSG review" value={`${STATUS_LABELS[c.status]}${data.reviewerName ? ` by ${data.reviewerName}` : ""}`} />
        <Fact label="Alert email" value={data.deliveries.length === 0 ? "Not sent" : `${delivered} of ${data.deliveries.length} accepted or delivered`} />
        <Fact label="Follow-up" value={`${FOLLOW_UP_LABELS[c.followUp]}${data.resolverName ? ` by ${data.resolverName}` : ""}`} />
      </section>

      <section aria-labelledby="alerts-heading" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 id="alerts-heading" className="text-base font-semibold text-brand-navy-900">
          What fired
        </h2>
        <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
          {alerts.map((a) => (
            <li key={a.id}>{a.label}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">From revision {c.sourceRevision} of the response.</p>
      </section>

      {c.status === "pending_review" && (
        <section aria-labelledby="review-heading" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="review-heading" className="text-base font-semibold text-brand-navy-900">
            Review
          </h2>
          <div className="mt-3">
            <ReviewPanel caseId={c.id} revision={c.revision} savedRecipients={data.savedRecipients} canReview={canReview} shopConfirmed={Boolean(c.shopId)} />
          </div>
        </section>
      )}

      {data.approvals.length > 0 && (
        <section aria-labelledby="approvals-heading" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
          <h2 id="approvals-heading" className="text-base font-semibold text-brand-navy-900">
            Approvals and delivery
          </h2>
          <ol className="mt-3 flex flex-col gap-4">
            {data.approvals.map(({ approval, approverName }) => (
              <li key={approval.id} className="text-sm">
                <p className="text-gray-900">
                  Approval {approval.approvalNumber} by {approverName ?? "System"} on {dateTime.format(approval.approvedAt)}
                </p>
                {approval.note && <p className="text-xs text-gray-600">Note: {approval.note}</p>}
                {JSON.stringify([...approval.recipients].sort()) !== JSON.stringify([...approval.savedRecipients].sort()) && (
                  <p className="text-xs text-gray-500">Recipients were adjusted for this alert. Saved list at the time: {approval.savedRecipients.join(", ") || "none"}.</p>
                )}
                <ul className="mt-1 flex flex-col gap-1">
                  {data.deliveries
                    .filter((d) => d.approvalId === approval.id)
                    .map((d) => (
                      <li key={d.recipient} className="flex flex-wrap justify-between gap-2 rounded bg-gray-50 px-3 py-1.5 text-xs">
                        <span className="text-gray-900">{d.recipient}</span>
                        <span className="text-gray-700">
                          {DELIVERY_LABELS[d.state] ?? d.state}
                          {d.stateReason ? ` (${d.stateReason.replaceAll("_", " ").toLowerCase()})` : ""}
                        </span>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="notes-heading" className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 id="notes-heading" className="text-base font-semibold text-brand-navy-900">
          Notes and follow-up
        </h2>
        {c.reviewNote && <p className="mt-2 text-sm text-gray-700">Review note: {c.reviewNote}</p>}
        {data.notes.length === 0 ? (
          <p className="mt-2 text-sm text-gray-600">No notes yet.</p>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {data.notes.map(({ note, authorName }) => (
              <li key={note.id} className="border-l-2 border-gray-200 pl-3 text-sm">
                <p className="text-xs text-gray-500">
                  {dateTime.format(note.createdAt)} · {authorName ?? "System"} ({note.authorKind === "shop" ? "shop" : "PSG"}) ·{" "}
                  {note.visibility === "internal" ? <span className="font-medium text-amber-800">PSG only</span> : "shared with the shop"}
                </p>
                <p className="whitespace-pre-wrap text-gray-900">{note.body}</p>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-4">
          <NoteForm caseId={c.id} />
        </div>
        {c.followUp === "resolved" ? (
          <p className="mt-4 text-sm text-gray-800">
            Resolved {c.resolvedAt ? dateTime.format(c.resolvedAt) : ""}: {RESOLUTION_OUTCOMES[c.resolutionOutcome as keyof typeof RESOLUTION_OUTCOMES] ?? c.resolutionOutcome}
          </p>
        ) : (
          (c.followUp === "open" || c.followUp === "closure_requested") &&
          canResolve && (
            <div className="mt-6 border-t border-gray-100 pt-4">
              <h3 className="text-sm font-semibold text-gray-900">Resolve</h3>
              {c.followUp === "closure_requested" && <p className="mt-1 text-sm text-amber-800">The shop has asked to close this case.</p>}
              <div className="mt-2">
                <ResolvePanel caseId={c.id} revision={c.revision} outcomes={Object.entries(RESOLUTION_OUTCOMES)} />
              </div>
            </div>
          )
        )}
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-sm text-gray-900">{value}</p>
    </div>
  );
}
