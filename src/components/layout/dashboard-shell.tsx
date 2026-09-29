"use client";

import { Bell, ChevronDown, Menu, Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { NAV_ICONS, SIDEBAR_COOKIE, type NavItem } from "./nav";
import { SignOutButton } from "./sign-out-button";
import { useDismiss } from "./use-dismiss";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Desktop collapses the sidebar in place; smaller screens open it as a drawer. */
function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true,
  );
}

function classes(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0]?.[0] ?? "?");
  return letters.toUpperCase();
}

/** The nav item whose href is the longest prefix of the current path. */
function activeHref(nav: NavItem[], pathname: string) {
  return nav
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

interface DashboardShellProps {
  title: string;
  nav: NavItem[];
  userName: string;
  userEmail: string;
  initialCollapsed: boolean;
  year: number;
  children: React.ReactNode;
}

export function DashboardShell({ title, nav, userName, userEmail, initialCollapsed, year, children }: DashboardShellProps) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<"notifications" | "profile" | null>(null);

  const notificationsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpenMenu(null), []);
  const closeDrawer = useCallback(() => setMobileOpen(false), []);
  const drawerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // Stable array so the dismiss effect does not re-subscribe on every render.
  const [drawerRefs] = useState(() => [drawerRef, toggleRef]);
  useDismiss(notificationsRef, openMenu === "notifications", closeMenu);
  useDismiss(profileRef, openMenu === "profile", closeMenu);
  useDismiss(drawerRefs, !isDesktop && mobileOpen, closeDrawer);

  const compact = isDesktop && collapsed;
  const showClose = isDesktop ? collapsed : mobileOpen;
  const sidebarVisible = isDesktop ? !collapsed : mobileOpen;
  const current = activeHref(nav, pathname);

  function toggleSidebar() {
    if (!isDesktop) {
      setMobileOpen((open) => !open);
      return;
    }
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <div className="flex min-h-screen w-full">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {mobileOpen && !isDesktop && <div aria-hidden="true" className="fixed inset-0 top-16 z-30 bg-black/40" />}

      <aside
        id="sidebar"
        ref={drawerRef}
        aria-label="Sidebar"
        inert={!isDesktop && !mobileOpen}
        className={classes(
          // Below the top bar on small screens so the close button stays visible.
          "fixed bottom-0 left-0 top-16 z-40 flex w-64 shrink-0 flex-col bg-linear-to-b from-[#15171c] to-[#23272f] text-white shadow-xl shadow-black/10 transition-[width,transform] duration-200",
          "lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          compact && "lg:w-[76px]",
        )}
      >
        <div className={classes("flex h-16 shrink-0 items-center border-b border-white/10", compact ? "justify-center px-2" : "px-5")}>
          <Link href="/" aria-label="PSG Survey home" className="flex items-center">
            {compact ? (
              <Image src="/brand/logo_mark.png" alt="" width={428} height={244} className="h-auto w-11" priority />
            ) : (
              <Image src="/brand/site_logo.png" alt="" width={1251} height={351} className="h-9 w-auto" priority />
            )}
          </Link>
        </div>

        {!compact && <p className="truncate px-5 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-widest text-white/50">{title}</p>}

        <nav aria-label="Workspace" className={classes("flex-1 overflow-y-auto py-3", compact ? "px-2" : "px-3")}>
          <ul className="flex flex-col gap-1">
            {nav.map((item) => {
              const Icon = NAV_ICONS[item.icon];
              const active = item.href === current;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={compact ? item.label : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={closeDrawer}
                    className={classes(
                      "flex items-center gap-3 rounded-lg py-2.5 text-sm transition",
                      compact ? "justify-center px-0" : "px-3",
                      active ? "bg-white/15 font-medium text-white shadow-inner ring-1 ring-white/15" : "text-white/70 hover:translate-x-0.5 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon aria-hidden="true" className={classes("size-5 shrink-0", active && "text-brand-red")} />
                    <span className={compact ? "sr-only" : "truncate"}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-gray-200/70 bg-white/85 px-4 backdrop-blur-md lg:px-6">
          <button
            ref={toggleRef}
            type="button"
            onClick={toggleSidebar}
            aria-controls="sidebar"
            aria-expanded={sidebarVisible}
            aria-label={sidebarVisible ? "Collapse sidebar" : "Expand sidebar"}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 hover:text-brand-navy-900"
          >
            {showClose ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </button>

          {/* Search results arrive with the customer and response modules; the field is in place for them. */}
          <form role="search" onSubmit={(event) => event.preventDefault()} className="relative min-w-0 max-w-md flex-1">
            <label htmlFor="global-search" className="sr-only">
              Search
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input
              id="global-search"
              type="search"
              placeholder="Search..."
              className="h-10 w-full rounded-lg border border-gray-200 bg-surface pl-9 pr-3 text-sm outline-none transition placeholder:text-gray-400 focus:border-brand-navy-700 focus:bg-white"
            />
          </form>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((menu) => (menu === "notifications" ? null : "notifications"))}
                aria-haspopup="true"
                aria-expanded={openMenu === "notifications"}
                aria-label="Notifications"
                className="flex size-10 items-center justify-center rounded-lg text-gray-600 transition hover:bg-gray-100 hover:text-brand-navy-900"
              >
                <Bell aria-hidden="true" className="size-5" />
              </button>
              {openMenu === "notifications" && (
                <div className="absolute right-0 top-12 w-72 rounded-xl border border-gray-200 bg-white shadow-lg">
                  <p className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-brand-navy-900">Notifications</p>
                  <p className="px-4 py-6 text-center text-sm text-gray-500">You have no new notifications.</p>
                </div>
              )}
            </div>

            <div ref={profileRef} className="relative">
              <button
                type="button"
                onClick={() => setOpenMenu((menu) => (menu === "profile" ? null : "profile"))}
                aria-haspopup="menu"
                aria-expanded={openMenu === "profile"}
                aria-label="Account menu"
                className="flex items-center gap-2 rounded-lg py-1.5 pl-1.5 pr-2 transition hover:bg-gray-100"
              >
                <span className="flex size-8 items-center justify-center rounded-full bg-brand-navy-900 text-xs font-semibold text-white">
                  {initials(userName)}
                </span>
                <span className="hidden max-w-40 truncate text-sm font-medium text-gray-700 sm:block">{userName}</span>
                <ChevronDown aria-hidden="true" className="size-4 text-gray-500" />
              </button>
              {openMenu === "profile" && (
                <div role="menu" aria-label="Account" className="absolute right-0 top-12 w-64 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  <div className="border-b border-gray-100 px-4 py-3">
                    <p className="truncate text-sm font-medium text-brand-navy-900">{userName}</p>
                    <p className="truncate text-xs text-gray-500">{userEmail}</p>
                  </div>
                  <SignOutButton
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50 hover:text-brand-red disabled:opacity-60"
                  />
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main" className="flex-1 overflow-x-auto p-4 sm:p-6 lg:p-8">
          {children}
        </main>

        <footer className="border-t border-gray-200 bg-white px-4 py-4 text-center text-xs text-gray-500 lg:px-8">
          &copy; {year} Phoenix Solutions Group. All rights reserved.
        </footer>
      </div>
    </div>
  );
}
