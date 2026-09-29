import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/pagination";
import { pageNumber, pageOf } from "@/lib/pagination";
import { hasCapability } from "@/modules/access/capabilities";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { REASON_LABELS, type ReasonCode } from "@/modules/imports/eligibility";
import { previewImport } from "@/modules/imports/imports";
import { fieldsFor, type Mapping } from "@/modules/imports/mapping";
import { SOURCE_SYSTEMS, type RowAction } from "@/modules/imports/store";
import { getShop } from "@/modules/shops/shops";
import { CommitPanel, MappingEditor } from "./batch-controls";

export const metadata: Metadata = { title: "Import" };

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const ACTION_LABELS: Record<RowAction, { label: string; style: string }> = {
  created: { label: "Created", style: "bg-emerald-100 text-emerald-800" },
  reused: { label: "Duplicate", style: "bg-gray-100 text-gray-700" },
  held: { label: "Held", style: "bg-amber-100 text-amber-800" },
  excluded: { label: "Excluded", style: "bg-gray-200 text-gray-800" },
  rejected: { label: "Failed", style: "bg-brand-red/10 text-brand-red-dark" },
};

const LEDGER_REASONS: Record<string, string> = {
  VISIT_ID_MISSING: "Visit ID missing",
  DATE_INVALID: "A date is not a real date",
  CASE_ID_MISSING: "Legacy case ID missing",
  STATUS_UNKNOWN: "Status is not clearly open or closed",
  CASE_REPEATED_IN_FILE: "Same case appears earlier in this file",
  CLOSED_REFERENCE_ONLY: "Closed in legacy: kept for reference only",
  UPDATED_FROM_LEGACY: "Known case: updated from the legacy system",
  ALREADY_IN_HUB: "Hub already follows this case up: left unchanged",
  DUPLICATE_CASE: "Imported by another file at the same time",
  EMAIL_MISSING: "No email in this row",
  EMAIL_INVALID: "Not a usable email address",
  ALREADY_OPTED_OUT: "Already opted out at this shop",
  EMAIL_REPEATED_IN_FILE: "Same email appears earlier in this file",
};

const KIND_LABELS: Record<string, string> = { visits: "Repair visits", legacy_ledger: "Legacy survey history", legacy_cases: "Legacy follow-up cases", opt_outs: "Existing opt-out list" };

const reasonLabel = (code: string) => REASON_LABELS[code as ReasonCode] ?? LEDGER_REASONS[code] ?? code;

export default async function ImportBatchPage({ params, searchParams }: PageProps<"/psg/imports/[batchId]">) {
  const current = await pageRequireCapability("psg.workspace");
  const canImport = hasCapability(current.principal, "import.manage");
  const { batchId } = await params;
  const preview = await previewImport(batchId);
  if (!preview) notFound();

  const { batch, counts, issues, rows } = preview;
  const query = await searchParams;
  // Every row is planned (the counts above include them all); only one page is drawn.
  const list = pageOf(rows, pageNumber(query.page));
  const shop = await getShop(batch.shopId);
  const fields = fieldsFor(batch.kind);
  const mapping = batch.mapping as Mapping;
  const shown = fields.filter((f) => mapping[f.key]);
  const sendCount = rows.filter((r) => r.send).length;
  const committed = batch.status === "committed";

  return (
    <div className="max-w-6xl">
      <Link href="/psg/imports" className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Imports
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-brand-navy-900">{batch.fileName}</h1>
        {batch.isTest && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Test data</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${committed ? "bg-emerald-100 text-emerald-800" : "bg-gray-100 text-gray-700"}`}>{committed ? "Committed" : "Preview"}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600">
        {shop?.name} · {KIND_LABELS[batch.kind]} · {SOURCE_SYSTEMS[batch.sourceSystem as keyof typeof SOURCE_SYSTEMS] ?? batch.sourceSystem} · {batch.rowCount} rows · uploaded{" "}
        {dateTime.format(batch.createdAt)}
        {batch.committedAt ? ` · committed ${dateTime.format(batch.committedAt)}` : ""}
      </p>
      <p className="mt-1 break-all font-mono text-xs text-gray-400">SHA-256 {batch.sourceHash}</p>

      <section aria-label="Row outcomes" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(Object.keys(ACTION_LABELS) as RowAction[]).map((action) => (
          <div key={action} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{ACTION_LABELS[action].label}</p>
            <p className="mt-1 text-2xl font-semibold text-brand-navy-900">{counts[action]}</p>
          </div>
        ))}
      </section>

      {!committed && canImport && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
          <section aria-labelledby="mapping-heading" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="mapping-heading" className="text-base font-semibold text-brand-navy-900">
              Columns
            </h2>
            <p className="mt-1 text-sm text-gray-600">We matched columns by their names. Check each one before committing.</p>
            <div className="mt-4">
              <MappingEditor batchId={batch.id} revision={batch.revision} headers={batch.headers} fields={fields} mapping={mapping} />
            </div>
          </section>
          <section aria-labelledby="commit-heading" className="h-fit rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="commit-heading" className="text-base font-semibold text-brand-navy-900">
              Commit
            </h2>
            {issues.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-brand-red-dark">
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <CommitPanel batchId={batch.id} revision={batch.revision} sendCount={sendCount} blocked={issues.length > 0} />
            </div>
          </section>
        </div>
      )}

      <section aria-labelledby="rows-heading" className="mt-6">
        <h2 id="rows-heading" className="text-base font-semibold text-brand-navy-900">
          {committed ? "Row outcomes" : "What each row will do"}
        </h2>
        <div className="relative mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Row</th>
                {shown.map((f) => (
                  <th key={f.key} scope="col" className="px-3 py-2 font-medium">
                    {f.label.replace(/ \(.*\)$/, "")}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium">Outcome</th>
                <th scope="col" className="px-3 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.items.map((r) => (
                <tr key={r.rowNumber}>
                  <td className="px-3 py-2 text-gray-500">{r.rowNumber}</td>
                  {shown.map((f) => (
                    <td key={f.key} className="max-w-48 truncate px-3 py-2 text-gray-800" title={r.raw[mapping[f.key]]}>
                      {r.raw[mapping[f.key]] || <span className="text-gray-400">blank</span>}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_LABELS[r.action].style}`}>{ACTION_LABELS[r.action].label}</span>
                    {r.send && <span className="ml-1 text-xs text-emerald-800">Email queued on commit</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-700">{r.reasons.map(reasonLabel).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...list} path={`/psg/imports/${batch.id}`} query={query} anchor="rows-heading" label="Import row pages" />
      </section>
    </div>
  );
}
