"use client";

import { useState, useTransition } from "react";
import { requestRenewalAction } from "./actions";

/** Sends a new link to the address already on record. The requester never enters an address (SR-22). */
export function RenewalButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "done" | "rate_limited">("idle");
  const [pending, startTransition] = useTransition();

  if (state === "done") {
    return (
      <p role="status" className="mt-4 max-w-md text-sm text-gray-700">
        Thank you. If we can renew this survey, a new link will arrive at the email address we have on file for your visit. It may take a few minutes.
      </p>
    );
  }
  return (
    <div className="mt-5 flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await requestRenewalAction(token);
            setState(result.ok ? "done" : "rate_limited");
          })
        }
        className="rounded-lg bg-brand-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60"
      >
        {pending ? "Sending…" : "Email me a new link"}
      </button>
      {state === "rate_limited" && (
        <p role="alert" className="text-sm text-brand-red">
          Too many requests. Please wait a minute and try again.
        </p>
      )}
    </div>
  );
}
