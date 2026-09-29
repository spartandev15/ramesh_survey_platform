"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CloseButton, Modal } from "@/components/modal";
import { ICON_BUTTON } from "@/components/row-actions";
import { deleteShopAction } from "./actions";

/** Delete with a Yes/No popup. The shop's records are kept (PDF 09). */
export function DeleteShopButton({ shopId, name, afterDelete, large = false }: { shopId: string; name: string; afterDelete?: string; large?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Modal
      title="Delete this shop?"
      onOpen={() => setMessage(null)}
      buttonClass={
        large
          ? "inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-brand-red transition hover:bg-red-50"
          : `${ICON_BUTTON} border-red-200 bg-red-50 text-brand-red hover:bg-red-100`
      }
      buttonTitle={large ? undefined : "Delete"}
      label={
        <>
          <Trash2 className="size-4" aria-hidden="true" />
          <span className={large ? "" : "sr-only"}>Delete</span>
        </>
      }
    >
      <p className="text-sm text-gray-700">
        Delete <strong className="font-semibold text-gray-900">{name}</strong>? It disappears from every list and screen, and its public link and imports stop working.
      </p>
      <p className="mt-2 text-sm text-gray-500">Its responses, cases, emails and history are kept, as the package requires.</p>
      {message && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-brand-red-dark">
          {message}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <CloseButton className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50">No, keep it</CloseButton>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteShopAction(shopId);
              if (!result.ok) return setMessage(result.message);
              if (afterDelete) router.push(afterDelete);
              else router.refresh();
            })
          }
          className="rounded-lg bg-brand-red px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-red-dark disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Yes, delete"}
        </button>
      </div>
    </Modal>
  );
}
