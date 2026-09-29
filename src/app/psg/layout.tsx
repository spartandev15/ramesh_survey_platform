import { WorkspaceShell, type NavItem } from "@/components/layout/workspace-shell";
import { pageRequireCapability } from "@/modules/access/page-guards";

// PDF section 7: PSG workspace. Items are added here as each module ships.
const NAV: NavItem[] = [
  { href: "/psg", label: "Overview", icon: "overview" },
  { href: "/psg/operations", label: "Operator queues", icon: "operations" },
  { href: "/psg/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/psg/shops", label: "Shops", icon: "shops" },
  { href: "/psg/readiness", label: "Launch readiness", icon: "readiness" },
  { href: "/psg/instruments", label: "Surveys", icon: "instruments" },
  { href: "/psg/imports", label: "Imports", icon: "imports" },
  { href: "/psg/invitations", label: "Invitations", icon: "invitations" },
  { href: "/psg/responses", label: "Responses", icon: "responses" },
  { href: "/psg/alerts", label: "Alert review", icon: "alerts" },
  { href: "/psg/legacy-cases", label: "Legacy cases", icon: "legacyCases" },
  { href: "/psg/suppression", label: "Suppression queue", icon: "suppression" },
  { href: "/psg/email", label: "Email review", icon: "emailReview" },
  { href: "/psg/bridge", label: "FileMaker bridge", icon: "bridge" },
  { href: "/psg/test-recipients", label: "Test recipients", icon: "testRecipients" },
];

export default async function PsgLayout({ children }: LayoutProps<"/psg">) {
  const current = await pageRequireCapability("psg.workspace");
  return (
    <WorkspaceShell title="PSG Workspace" nav={NAV} userName={current.name} userEmail={current.email}>
      {children}
    </WorkspaceShell>
  );
}
