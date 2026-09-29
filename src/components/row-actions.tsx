import { Eye, Pencil, type LucideIcon } from "lucide-react";
import Link from "next/link";

/**
 * View and edit buttons for a list row: icons on one line, each with a
 * tooltip and a spoken name. Records are never deleted from a list: the
 * package keeps every record and its history (PDF 09).
 */
const ICONS: Record<"view" | "edit", LucideIcon> = { view: Eye, edit: Pencil };

export const ICON_BUTTON = "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition";

export function RowActions({ actions }: { actions: { href: string; label: string; kind: "view" | "edit"; title?: string }[] }) {
  return (
    <div className="flex justify-end gap-1.5">
      {actions.map((a) => {
        const Icon = ICONS[a.kind];
        return (
          <Link
            key={a.href}
            href={a.href}
            title={a.title ?? a.label}
            className={`${ICON_BUTTON} ${a.kind === "edit" ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function ActionsHeader() {
  return (
    <th scope="col" className="px-4 py-3 text-right font-medium">
      Actions
    </th>
  );
}
