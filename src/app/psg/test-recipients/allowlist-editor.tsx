"use client";

import { Trash2, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { TextField } from "@/components/form/text-field";
import { addEntryAction, removeEntryAction } from "./actions";

export function AddEntryForm() {
  const [entry, setEntry] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The list is paged, so say what was added: it may be on another page.
  const [added, setAdded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAdded(null);
    startTransition(async () => {
      const result = await addEntryAction(entry, note);
      if (!result.ok) return setError(result.message);
      setAdded(entry.trim());
      setEntry("");
      setNote("");
    });
  }

  return (
    <form onSubmit={add} noValidate className="flex flex-col gap-4">
      {error && <FormAlert tone="error">{error}</FormAlert>}
      {added && <FormAlert tone="success">Added {added} to the list.</FormAlert>}
      <TextField id="entry" label="Email address or @domain" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="name@phoenixsolutionsgroup.net" />
      <TextField id="note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who this is for" />
      <button
        type="submit"
        disabled={pending || !entry.trim()}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-red px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-red-dark disabled:opacity-50"
      >
        <UserPlus aria-hidden="true" className="size-4" />
        {pending ? "Adding…" : "Add to list"}
      </button>
    </form>
  );
}

export function RemoveEntryButton({ id, entry }: { id: string; entry: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        type="button"
        disabled={pending}
        aria-label={`Remove ${entry}`}
        onClick={() =>
          startTransition(async () => {
            const result = await removeEntryAction(id);
            if (!result.ok) return setError(result.message);
          })
        }
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
        {pending ? "Removing…" : "Remove"}
      </button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-brand-red">
          {error}
        </span>
      )}
    </>
  );
}
