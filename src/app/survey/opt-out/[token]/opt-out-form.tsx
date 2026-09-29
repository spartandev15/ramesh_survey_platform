"use client";

import { CheckCircle2 } from "lucide-react";
import { useState, useTransition } from "react";
import { confirmOptOutAction } from "./actions";

export function OptOutForm({ token, shopName }: { token: string; shopName: string }) {
  const [state, setState] = useState<"idle" | "done" | "error" | "rate_limited">("idle");
  const [pending, startTransition] = useTransition();

  if (state === "done") {
    return (
      <div role="status" className="flex flex-col items-center text-center">
        <CheckCircle2 aria-hidden="true" className="size-12 text-emerald-600" />
        <h1 className="mt-4 text-2xl font-semibold text-brand-navy-900">You are opted out</h1>
        <p className="mt-2 max-w-md text-gray-600">{shopName} will not send you survey emails again. This does not affect any other shop.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center">
      <h1 className="text-2xl font-semibold text-brand-navy-900">Stop survey emails from {shopName}?</h1>
      <p className="mt-2 max-w-md text-gray-600">You will not get survey invitations or reminders from {shopName} again. Emails from other shops are not affected.</p>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await confirmOptOutAction(token);
            setState(result.ok ? "done" : result.reason === "rate_limited" ? "rate_limited" : "error");
          })
        }
        className="mt-6 rounded-lg bg-brand-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60"
      >
        {pending ? "Saving…" : "Yes, stop survey emails"}
      </button>
      {state !== "idle" && (
        <p role="alert" className="mt-3 text-sm text-brand-red">
          {state === "rate_limited" ? "Too many requests. Please wait a minute and try again." : "This link is not valid. Please contact the shop."}
        </p>
      )}
    </div>
  );
}
