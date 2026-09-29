"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { uploadImportAction } from "./actions";

const field = "w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-navy-700";

/** Upload stages the rows only. Nothing is created or sent until PSG reviews the preview and commits. */
export function UploadForm({ shops, sourceSystems }: { shops: { id: string; name: string; isTestShop: boolean }[]; sourceSystems: [string, string][] }) {
  const router = useRouter();
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");
  const [error, setError] = useState<{ message: string; issues?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const testShop = shops.find((s) => s.id === shopId)?.isTestShop ?? false;

  if (shops.length === 0) return <p className="text-sm text-gray-600">Create a shop first.</p>;

  function upload(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await uploadImportAction(formData);
      if (!result.ok) return setError({ message: result.message, issues: result.issues });
      router.push(`/psg/imports/${result.batchId}`);
    });
  }

  return (
    <form action={upload} className="flex flex-col gap-4">
      {error && <FormAlert tone="error">{error.message}</FormAlert>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="shopId" className="text-sm font-medium text-gray-700">
          Shop
        </label>
        <select id="shopId" name="shopId" value={shopId} onChange={(e) => setShopId(e.target.value)} className={field}>
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isTestShop ? " (internal test)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="kind" className="text-sm font-medium text-gray-700">
          What is in the file
        </label>
        <select id="kind" name="kind" defaultValue="visits" className={field}>
          <option value="visits">Customer repair visits</option>
          <option value="legacy_ledger">Legacy survey history (sent and completed)</option>
          <option value="legacy_cases">Legacy follow-up cases (open and closed)</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="dataType" className="text-sm font-medium text-gray-700">
          Data type
        </label>
        <select id="dataType" name="dataType" defaultValue={testShop ? "test" : "production"} key={shopId} className={field} disabled={testShop}>
          <option value="production">Production (real customers)</option>
          <option value="test">Test (synthetic or internal only)</option>
        </select>
        {testShop && <input type="hidden" name="dataType" value="test" />}
        <p className="text-xs text-gray-500">Test data never reaches customers or production reports, and never becomes production data later.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sourceSystem" className="text-sm font-medium text-gray-700">
          Source
        </label>
        <select id="sourceSystem" name="sourceSystem" className={field}>
          {sourceSystems.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="file" className="text-sm font-medium text-gray-700">
          CSV file
        </label>
        <input id="file" name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
        <p className="text-xs text-gray-500">First row must hold column names. Up to 5 MB and 5,000 records.</p>
      </div>
      <button type="submit" disabled={pending} aria-busy={pending} className="rounded-lg bg-brand-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-red-dark disabled:opacity-60">
        {pending ? "Uploading…" : "Upload and preview"}
      </button>
    </form>
  );
}
