import type { ShopMode } from "@/modules/shops/settings-policy";
import { MODE_LABELS } from "@/modules/shops/fields";

const STYLES: Record<ShopMode, string> = {
  test: "bg-amber-100 text-amber-800",
  live: "bg-emerald-100 text-emerald-800",
  paused: "bg-gray-200 text-gray-800",
};

/** Mode is shown as text, never colour alone (SR-39). */
export function ModeBadge({ mode }: { mode: ShopMode }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[mode]}`}>{MODE_LABELS[mode]}</span>;
}
