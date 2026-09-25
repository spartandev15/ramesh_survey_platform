"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createTestLinkAction } from "../actions";

/** Create a TEST survey link. The link is shown once because only its hash is stored. */
export function TestLinkForm({ versionId, shops }: { versionId: string; shops: { id: string; name: string; isTestShop: boolean }[] }) {
  const router = useRouter();
  const shopFieldId = useId();
  const daysFieldId = useId();
  const [shopId, setShopId] = useState(shops.find((s) => s.isTestShop)?.id ?? shops[0]?.id ?? "");
  const [days, setDays] = useState(90);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  if (shops.length === 0) return <p className="text-sm text-gray-600">Create a shop first. Test links show that shop&rsquo;s name and branding.</p>;

  function create() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createTestLinkAction({ shopId, instrumentVersionId: versionId, lifetimeDays: days });
      if (!result.ok) return setError(result.message);
      setCreated({ url: result.url, expiresAt: result.expiresAt });
      router.refresh();
    });
  }

  const field = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-navy-700";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={shopFieldId} className="block text-sm font-medium text-gray-700">
            Shop shown on the survey
          </label>
          <select id={shopFieldId} value={shopId} onChange={(e) => setShopId(e.target.value)} className={`${field} mt-1`}>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isTestShop ? " (internal test)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={daysFieldId} className="block text-sm font-medium text-gray-700">
            Link valid for (days)
          </label>
          <input id={daysFieldId} type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${field} mt-1 w-28`} />
        </div>
        <button type="button" onClick={create} disabled={pending || !shopId} className="rounded-lg bg-brand-red px-4 py-2 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-50">
          {pending ? "Creating…" : "Create test link"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
      )}
      {created && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-medium text-emerald-900">Test link created. Copy it now: for security it cannot be shown again.</p>
          <p className="mt-2 break-all rounded bg-white px-3 py-2 font-mono text-xs text-gray-900">{created.url}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(created.url);
                setCopied(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-navy-700"
            >
              {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={created.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-navy-700">
              <ExternalLink aria-hidden="true" className="size-4" /> Open survey
            </a>
          </div>
          <p className="mt-2 text-xs text-gray-600">Expires {new Date(created.expiresAt).toLocaleString()}.</p>
        </div>
      )}
    </div>
  );
}
