"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { correctInvitationAction, printableLinkAction, recordOptOutAction, sendInvitationsAction } from "./actions";

export interface QueueItem {
  id: string;
  visitId: string;
  revision: number;
  isTest: boolean;
  sourceVisitKey: string;
  customerName: string;
  email: string | null;
  deliveredOn: string | null;
  deliveredOnRaw: string | null;
  reasons: string[];
  printable: boolean;
  intentState: string | null;
  intentReason: string | null;
}

const field = "rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-navy-700";

/**
 * One queue view. Only "ready" rows can be selected and sent; every send is
 * rechecked on the server (SR-04, SR-11).
 */
export function QueueTable({ shopId, items, selectable, canManage }: { shopId: string; items: QueueItem[]; selectable: boolean; canManage: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string; details?: string[] } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function send() {
    setMessage(null);
    startTransition(async () => {
      const chosen = items.filter((i) => selected.has(i.id)).map((i) => ({ id: i.id, revision: i.revision }));
      const result = await sendInvitationsAction(shopId, chosen);
      setConfirming(false);
      if (!result.ok) return setMessage({ tone: "error", text: result.message });
      const sent = result.results.filter((r) => r.ok).length;
      const refused = result.results.filter((r) => !r.ok);
      const names = new Map(items.map((i) => [i.id, `${i.customerName} (${i.sourceVisitKey})`]));
      setMessage({
        tone: refused.length ? "error" : "success",
        text: `${sent} invitation${sent === 1 ? "" : "s"} queued to send.${refused.length ? ` ${refused.length} refused.` : ""}`,
        details: refused.map((r) => `${names.get(r.id)}: ${r.ok ? "" : (r.message ?? r.reasons.join(", "))}`),
      });
      setSelected(new Set());
    });
  }

  if (items.length === 0) return <p className="rounded-xl border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">Nothing here.</p>;

  return (
    <div className="flex flex-col gap-3">
      {message && (
        <div role={message.tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${message.tone === "error" ? "border-brand-red/30 bg-brand-red/5 text-brand-red-dark" : "border-green-600/30 bg-green-50 text-green-800"}`}>
          <p>{message.text}</p>
          {message.details && message.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {message.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectable && canManage && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200/80 bg-white p-3 shadow-sm">
          <button type="button" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)))} className="text-sm text-brand-navy-900 underline-offset-2 hover:underline">
            {selected.size === items.length ? "Clear selection" : "Select all"}
          </button>
          <span className="text-sm text-gray-600">{selected.size} selected</span>
          {!confirming ? (
            <button type="button" disabled={selected.size === 0} onClick={() => setConfirming(true)} className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50">
              Send selected
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
              Send {selected.size} survey invitation{selected.size === 1 ? "" : "s"} to customers now?
              <button type="button" onClick={send} disabled={pending} className="rounded-lg bg-brand-red px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                {pending ? "Sending…" : "Yes, send"}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700">
                Cancel
              </button>
            </span>
          )}
        </div>
      )}

      <div tabIndex={0} className="relative overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-2xl border border-gray-200/80 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50/70 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              {selectable && canManage && (
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Select</span>
                </th>
              )}
              <th scope="col" className="px-3 py-3 font-medium">Visit</th>
              <th scope="col" className="px-3 py-3 font-medium">Customer</th>
              <th scope="col" className="px-3 py-3 font-medium">Delivered</th>
              <th scope="col" className="px-3 py-3 font-medium">Status</th>
              {canManage && (
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => (
              <Row key={item.id} shopId={shopId} item={item} selectable={selectable && canManage} checked={selected.has(item.id)} onToggle={() => toggle(item.id)} canManage={canManage} editing={editing === item.id} onEdit={(open) => setEditing(open ? item.id : null)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  shopId,
  item,
  selectable,
  checked,
  onToggle,
  canManage,
  editing,
  onEdit,
}: {
  shopId: string;
  item: QueueItem;
  selectable: boolean;
  checked: boolean;
  onToggle: () => void;
  canManage: boolean;
  editing: boolean;
  onEdit: (open: boolean) => void;
}) {
  const [email, setEmail] = useState(item.email ?? "");
  const [deliveredOn, setDeliveredOn] = useState(item.deliveredOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; qr: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmOptOut, setConfirmOptOut] = useState(false);
  const colSpan = (selectable ? 1 : 0) + 4 + (canManage ? 1 : 0);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await correctInvitationAction(shopId, item.id, item.revision, { email, deliveredOn });
      if (!result.ok) return setError(result.message);
      onEdit(false);
    });
  }

  function optOut() {
    setError(null);
    startTransition(async () => {
      const result = await recordOptOutAction(item.id);
      if (!result.ok) return setError(result.message);
      setConfirmOptOut(false);
      onEdit(false);
    });
  }

  function printable() {
    setError(null);
    startTransition(async () => {
      const result = await printableLinkAction(shopId, item.id);
      if (!result.ok) return setError([result.message, ...(result.reasons ?? [])].join(" "));
      setLink({ url: result.url, qr: result.qr, expiresAt: result.expiresAt });
    });
  }

  return (
    <>
      <tr className="hover:bg-gray-50/60">
        {selectable && (
          <td className="px-3 py-3">
            <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${item.customerName}, visit ${item.sourceVisitKey}`} className="size-4 accent-brand-red" />
          </td>
        )}
        <td className="px-3 py-3 font-mono text-xs text-gray-800">
          {item.sourceVisitKey}
          {item.isTest && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 font-sans text-[11px] font-medium text-amber-800">Test</span>}
        </td>
        <td className="px-3 py-3">
          <span className="font-medium text-gray-900">{item.customerName}</span>
          <span className="block text-xs text-gray-500">{item.email ?? "No email"}</span>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-gray-700">
          {item.deliveredOn ?? (item.deliveredOnRaw ? <span className="text-brand-red-dark">Unreadable: {item.deliveredOnRaw}</span> : <span className="text-gray-500">Missing</span>)}
        </td>
        <td className="px-3 py-3 text-xs text-gray-700">{item.intentState ? `Email ${item.intentState.replace("_", " ")}${item.intentReason ? `: ${item.intentReason}` : ""}` : item.reasons.join("; ") || "Eligible"}</td>
        {canManage && (
          <td className="whitespace-nowrap px-3 py-3 text-right">
            {!item.intentState && (
              <button type="button" onClick={() => onEdit(!editing)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-indigo-300 hover:text-indigo-700">
                {editing ? "Close" : "Fix details"}
              </button>
            )}
            {item.printable && (
              <button type="button" onClick={printable} disabled={pending} className="ml-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50">
                Printable link
              </button>
            )}
            <Link href={`/psg/responses/paper?shop=${shopId}&visit=${item.visitId}`} className="ml-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:border-indigo-300 hover:text-indigo-700">
              Paper survey
            </Link>
          </td>
        )}
      </tr>
      {(editing || link || error) && (
        <tr>
          <td colSpan={colSpan} className="bg-gray-50 px-3 py-3">
            {editing && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`email-${item.id}`} className="text-xs font-medium text-gray-700">
                    Email
                  </label>
                  <input id={`email-${item.id}`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`delivered-${item.id}`} className="text-xs font-medium text-gray-700">
                    Delivery date
                  </label>
                  <input id={`delivered-${item.id}`} type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} className={field} />
                </div>
                <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-brand-navy-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  {pending ? "Saving…" : "Save"}
                </button>
                <p className="w-full text-xs text-gray-500">Saving does not send anything. Use Send afterwards once the record is ready.</p>
                {item.email && (
                  <div className="flex w-full flex-wrap items-center gap-2 border-t border-gray-200 pt-3 text-xs text-gray-700">
                    {!confirmOptOut ? (
                      <button type="button" onClick={() => setConfirmOptOut(true)} className="text-brand-red underline-offset-2 hover:underline">
                        Customer asked to stop survey emails
                      </button>
                    ) : (
                      <>
                        <span>Stop all survey emails to {item.email} from this shop?</span>
                        <button type="button" onClick={optOut} disabled={pending} className="rounded-lg bg-brand-red px-3 py-1 font-semibold text-white disabled:opacity-50">
                          Yes, opt out
                        </button>
                        <button type="button" onClick={() => setConfirmOptOut(false)} className="rounded-lg border border-gray-300 bg-white px-3 py-1">
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {link && (
              <div role="status" className="text-sm">
                <p className="font-medium text-emerald-900">Printable link created. Copy it now: for security it cannot be shown again.</p>
                <p className="mt-1 break-all rounded bg-white px-3 py-2 font-mono text-xs text-gray-900">{link.url}</p>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link.url);
                    setCopied(true);
                  }}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700"
                >
                  {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, not a remote image */}
                  <img src={link.qr} alt={`QR code for the survey link for visit ${item.sourceVisitKey}`} className="size-40 rounded border border-gray-200 bg-white" />
                  <a href={link.qr} download={`survey-qr-${item.sourceVisitKey}.svg`} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700">
                    Download QR code
                  </a>
                </div>
                <p className="mt-1 text-xs text-gray-600">Expires {new Date(link.expiresAt).toLocaleString()}.</p>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-brand-red">
                {error}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
