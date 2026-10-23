import type { LucideIcon } from "lucide-react";

/** Small building blocks shared by the PSG pages. */

/** A labelled filter or form control. */
export function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium text-gray-500">
        {label}
      </label>
      {children}
    </div>
  );
}

const count = (value: string | number) => (typeof value === "number" ? value.toLocaleString("en-US") : value);

/** A white summary tile: round icon, number, label and a short note. */
export function Tile({ icon: Icon, tone, value, label, note }: { icon: LucideIcon; tone: string; value: string | number; label: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm">
      <span className={`rounded-full p-3 ${tone}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-semibold tabular-nums text-brand-navy-900">{count(value)}</p>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="truncate text-xs text-gray-500">{note}</p>
      </div>
    </div>
  );
}

const KPI_TONES = {
  blue: { card: "bg-linear-to-br from-blue-50 to-white border-blue-100", icon: "bg-blue-100 text-blue-600" },
  green: { card: "bg-linear-to-br from-emerald-50 to-white border-emerald-100", icon: "bg-emerald-100 text-emerald-600" },
  amber: { card: "bg-linear-to-br from-amber-50 to-white border-amber-100", icon: "bg-amber-100 text-amber-600" },
  rose: { card: "bg-linear-to-br from-rose-50 to-white border-rose-100", icon: "bg-rose-100 text-rose-600" },
  orange: { card: "bg-linear-to-br from-orange-50 to-white border-orange-100", icon: "bg-orange-100 text-orange-600" },
  purple: { card: "bg-linear-to-br from-violet-50 to-white border-violet-100", icon: "bg-violet-100 text-violet-600" },
};

/** A tinted headline card: icon, label, number, note, and room for a small chart. */
export function Kpi({ tone, icon: Icon, label, value, note, children }: { tone: keyof typeof KPI_TONES; icon: LucideIcon; label: string; value: number; note: string; children?: React.ReactNode }) {
  const t = KPI_TONES[tone];
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-5 shadow-sm ${t.card}`}>
      <span className={`rounded-xl p-2.5 ${t.icon}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-600">{label}</p>
        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tabular-nums text-brand-navy-900">{count(value)}</p>
          {children}
        </div>
        <p className="mt-1 text-xs text-gray-500">{note}</p>
      </div>
    </div>
  );
}
