export function StatusBadge({ status }: { status: "draft" | "published" }) {
  return status === "published" ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Published</span>
  ) : (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">Draft</span>
  );
}

/** Test versions can never be used for Live customers (AT-14). */
export function TestBadge({ isTest }: { isTest: boolean }) {
  return isTest ? (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Test only</span>
  ) : (
    <span className="rounded-full bg-brand-navy-900/10 px-2 py-0.5 text-xs font-medium text-brand-navy-900">Verified source</span>
  );
}
