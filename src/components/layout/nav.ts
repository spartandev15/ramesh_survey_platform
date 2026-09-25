import { BarChart3, ClipboardList, LayoutDashboard, Store, type LucideIcon } from "lucide-react";

/**
 * Icons are referenced by name so server layouts can pass nav items to the
 * client shell (components cannot cross the server/client boundary).
 */
export const NAV_ICONS = {
  overview: LayoutDashboard,
  shops: Store,
  instruments: ClipboardList,
  dashboard: BarChart3,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof NAV_ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
}

/** Remembers the desktop sidebar state so the server renders it without a flash. */
export const SIDEBAR_COOKIE = "psg.sidebar";
