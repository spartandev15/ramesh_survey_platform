import { isManualItem, type Check } from "@/modules/readiness/policy";
import { ItemControl } from "./item-control";

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

const STATUS: Record<Check["status"], { text: string; style: string }> = {
  pass: { text: "Done", style: "bg-emerald-100 text-emerald-800" },
  fail: { text: "Missing", style: "bg-brand-red/10 text-brand-red-dark" },
  info: { text: "Note", style: "bg-gray-100 text-gray-700" },
};

/** One shop's launch checklist; the status is written out, never shown by colour alone (SR-39). */
export function Checklist({ shopId, checks, canManage }: { shopId: string; checks: Check[]; canManage: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-gray-100">
      {checks.map((c) => (
        <li key={c.key} className="py-2.5">
          <div className="flex flex-wrap items-start gap-2">
            <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[c.status].style}`}>{STATUS[c.status].text}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">{c.label}</p>
              <p className="break-words text-xs text-gray-600">{c.detail}</p>
              {c.confirmation && (
                <p className="mt-0.5 break-words text-xs text-gray-700">
                  Confirmed by {c.confirmation.by}, {dateTime.format(c.confirmation.at)}: “{c.confirmation.note}”
                </p>
              )}
              {canManage && isManualItem(c.key) && <ItemControl shopId={shopId} item={c.key} label={c.label} confirmed={Boolean(c.confirmation)} />}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
