"use client";

import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FormAlert } from "@/components/form/form-alert";
import { uploadImportAction } from "./actions";

const field = "h-11 w-full rounded-xl border border-gray-300 bg-white px-3.5 text-sm outline-none focus:border-indigo-500";

/** Upload stages the rows only. Nothing is created or sent until PSG reviews the preview and commits. */
export function UploadForm({ shops, sourceSystems }: { shops: { id: string; name: string; isTestShop: boolean }[]; sourceSystems: [string, string][] }) {
  const router = useRouter();
  const [shopId, setShopId] = useState(shops[0]?.id ?? "");
  const [error, setError] = useState<{ message: string; issues?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
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
          <option value="opt_outs">Existing opt-out list (emails)</option>
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
        <input
          ref={fileInput}
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          className="peer sr-only"
        />
        {/* The drop area is a second label for the same input, so a click or a dropped file both fill it. */}
        <label
          htmlFor="file"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (fileInput.current && e.dataTransfer.files.length) {
              fileInput.current.files = e.dataTransfer.files;
              setFileName(e.dataTransfer.files[0].name);
            }
          }}
          className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-red ${dragging ? "border-indigo-500 bg-indigo-50" : "border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50"}`}
        >
          <span className="rounded-full bg-indigo-600 p-2.5 text-white" aria-hidden="true">
            <ArrowUp className="size-5" />
          </span>
          <span className="text-sm font-semibold text-brand-navy-900">{fileName ?? "Drag and drop your CSV file here"}</span>
          <span className="text-xs text-gray-600">
            {fileName ? "Choose a different file" : <>or <span className="font-medium text-indigo-700 underline">browse files</span></>}
          </span>
        </label>
        <p className="text-xs text-gray-500">First row must hold column names. Up to 5 MB and 5,000 records.</p>
      </div>
      <button type="submit" disabled={pending} aria-busy={pending} className="h-11 rounded-xl bg-brand-red px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-red-dark disabled:opacity-60">
        {pending ? "Uploading…" : "Upload and preview"}
      </button>
    </form>
  );
}
