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
      userName={current.name}
      userEmail={current.email}
    >
      {children}
    </WorkspaceShell>
  );
}
