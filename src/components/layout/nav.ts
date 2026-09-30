import { Activity, Archive, ArrowRightLeft, BarChart3, BellRing, ClipboardCheck, ClipboardList, FileUp, House, Inbox, ListChecks, MailCheck, MailWarning, MessageSquareWarning, Send, Store, type LucideIcon } from "lucide-react";

/**
 * Icons are referenced by name so server layouts can pass nav items to the
 * client shell (components cannot cross the server/client boundary).
 */
export const NAV_ICONS = {
  overview: House,
  operations: Activity,
  shops: Store,
  readiness: ClipboardCheck,
  instruments: ClipboardList,
  dashboard: BarChart3,
  testRecipients: MailCheck,
  imports: FileUp,
  invitations: Send,
  emailReview: MailWarning,
  responses: Inbox,
  alerts: BellRing,
  suppression: ListChecks,
  cases: MessageSquareWarning,
  legacyCases: Archive,
  bridge: ArrowRightLeft,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof NAV_ICONS;

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Sidebar section heading; consecutive items with the same group sit under one heading. */
  group?: string;
}

/** Remembers the desktop sidebar state so the server renders it without a flash. */
export const SIDEBAR_COOKIE = "psg.sidebar";
