import { WorkspaceShell, type NavItem } from "@/components/layout/workspace-shell";
import { pageRequireCapability } from "@/modules/access/page-guards";

// PDF section 7: PSG workspace. Items are added here as each module ships.
const NAV: NavItem[] = [
  { href: "/psg", label: "Overview", icon: "overview" },
  { href: "/psg/operations", label: "Operator queues", icon: "operations", group: "Operations" },
  { href: "/psg/shops", label: "Shops", icon: "shops", group: "Operations" },
  { href: "/psg/instruments", label: "Surveys", icon: "instruments", group: "Operations" },
  { href: "/psg/responses", label: "Responses", icon: "responses", group: "Operations" },
  { href: "/psg/alerts", label: "Alert review", icon: "alerts", group: "Operations" },
  { href: "/psg/dashboard", label: "Dashboard", icon: "dashboard", group: "Operations" },
  { href: "/psg/readiness", label: "Launch readiness", icon: "readiness", group: "Manage" },
  { href: "/psg/imports", label: "Imports", icon: "imports", group: "Manage" },
  { href: "/psg/invitations", label: "Invitations", icon: "invitations", group: "Manage" },
  { href: "/psg/legacy-cases", label: "Legacy cases", icon: "legacyCases", group: "Manage" },
  { href: "/psg/suppression", label: "Suppression queue", icon: "suppression", group: "Manage" },
  { href: "/psg/email", label: "Email review", icon: "emailReview", group: "Manage" },
  { href: "/psg/bridge", label: "FileMaker bridge", icon: "bridge", group: "Manage" },
  { href: "/psg/test-recipients", label: "Test recipients", icon: "testRecipients", group: "System" },
];

export default async function PsgLayout({ children }: LayoutProps<"/psg">) {
  const current = await pageRequireCapability("psg.workspace");
  return (
    <WorkspaceShell title="PSG Workspace" nav={NAV} userName={current.name} userEmail={current.email}>
      {children}
    </WorkspaceShell>
  );
}
