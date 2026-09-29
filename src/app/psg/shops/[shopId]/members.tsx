"use client";

import { useState, useTransition } from "react";
import { addMemberAction, removeMemberAction } from "./member-actions";

const field = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";

/** People at the shop who can see its dashboard (SR-01). */
export function ShopMembers({ shopId, members, canManage }: { shopId: string; members: { userId: string; name: string; email: string }[]; canManage: boolean }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await addMemberAction(shopId, email, name);
      if (!result.ok) return setMessage({ tone: "error", text: result.message });
      setMessage({ tone: "success", text: result.created ? `Added. ${email} will get an email to set a password.` : `Added. ${email} can sign in with their existing account.` });
      setEmail("");
      setName("");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {members.length === 0 ? (
        <p className="text-sm text-gray-600">Nobody at this shop has access yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 text-sm">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="text-gray-900">{m.name}</span>
                <span className="block text-xs text-gray-500">{m.email}</span>
              </span>
              {canManage && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeMemberAction(shopId, m.userId);
                      if (!result.ok) return setMessage({ tone: "error", text: result.message });
                    })
                  }
                  aria-label={`Remove ${m.name}`}
                  className="text-sm text-brand-red hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="member-name" className="text-xs font-medium text-gray-700">
              Name
            </label>
            <input id="member-name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="member-email" className="text-xs font-medium text-gray-700">
              Email
            </label>
            <input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
          <button type="submit" disabled={pending || !email || !name} className="rounded-lg bg-brand-navy-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Adding…" : "Add shop user"}
          </button>
        </form>
      )}
      {message && (
        <p role={message.tone === "error" ? "alert" : "status"} className={`text-sm ${message.tone === "error" ? "text-brand-red" : "text-green-800"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
