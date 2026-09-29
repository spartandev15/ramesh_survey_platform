"use client";

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
      <button type="submit" disabled={pending || !entry.trim()} className="rounded-lg bg-brand-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60">
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
        className="text-sm text-brand-red hover:underline disabled:opacity-50"
      >
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
