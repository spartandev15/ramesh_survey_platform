import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { PSG_NAV } from "./nav";

export default async function PsgLayout({ children }: LayoutProps<"/psg">) {
  const current = await pageRequireCapability("psg.workspace");
  return (
    <WorkspaceShell title="PSG Workspace" nav={PSG_NAV} search="/psg/search" notifications="/api/notifications" userName={current.name} userEmail={current.email}>
      {children}
    </WorkspaceShell>
  );
}
