import { WorkspaceShell, type NavItem } from "@/components/layout/workspace-shell";
import { pageRequireCapability } from "@/modules/access/page-guards";

// PDF section 7: PSG workspace. Items are added here as each module ships.
const NAV: NavItem[] = [
  { href: "/psg", label: "Overview", icon: "overview" },
  { href: "/psg/shops", label: "Shops", icon: "shops" },
  { href: "/psg/instruments", label: "Surveys", icon: "instruments" },
];

export default async function PsgLayout({ children }: LayoutProps<"/psg">) {
  const current = await pageRequireCapability("psg.workspace");
  return (
    <WorkspaceShell title="PSG Workspace" nav={NAV} userName={current.name} userEmail={current.email}>
      {children}
    </WorkspaceShell>
  );
}
