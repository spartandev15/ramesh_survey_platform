import { notFound } from "next/navigation";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { pageRequireShopRead } from "@/modules/access/page-guards";
import { getShop } from "@/modules/shops/shops";

// PDF section 7: shop workspace (dashboard, response detail, notes and closure requests).
export default async function ShopLayout({ children, params }: LayoutProps<"/shop/[shopId]">) {
  const { shopId } = await params;
  const current = await pageRequireShopRead(shopId);
  const shop = await getShop(shopId);
  if (!shop) notFound();

  return (
    <WorkspaceShell
      title={shop.name}
      nav={[
        { href: `/shop/${shopId}`, label: "Survey dashboard", icon: "dashboard" },
        { href: `/shop/${shopId}/cases`, label: "Follow-up", icon: "cases" },
      ]}
      search={`/shop/${shopId}/search`}
      notifications={`/api/notifications?shop=${shopId}`}
      userName={current.name}
      userEmail={current.email}
    >
      {children}
      {/* PSG controls setup (SR-01, PDF 03 §7): shops ask for changes rather than make them. */}
      <p className="mt-10 border-t border-gray-200 pt-4 text-xs text-gray-500">
        Need a change to your survey, branding, alert recipients or who can sign in here? Ask your PSG account contact. PSG makes the change and it is recorded in the
        shop&apos;s history.
      </p>
    </WorkspaceShell>
  );
}
