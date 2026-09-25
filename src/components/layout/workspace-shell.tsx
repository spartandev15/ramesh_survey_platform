import { cookies } from "next/headers";
import { DashboardShell } from "./dashboard-shell";
import { SIDEBAR_COOKIE, type NavItem } from "./nav";

export type { NavItem } from "./nav";

interface WorkspaceShellProps {
  title: string;
  nav: NavItem[];
  userName: string;
  userEmail: string;
  children: React.ReactNode;
}

/** Sidebar, top bar and footer shared by the PSG and shop workspaces. */
export async function WorkspaceShell({ title, nav, userName, userEmail, children }: WorkspaceShellProps) {
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  return (
    <DashboardShell
      title={title}
      nav={nav}
      userName={userName}
      userEmail={userEmail}
      initialCollapsed={collapsed}
      year={new Date().getFullYear()}
    >
      {children}
    </DashboardShell>
  );
}
