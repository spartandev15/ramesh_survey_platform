import { readShopLogo } from "@/modules/shops/logo";

/** A shop's uploaded logo for its customer surveys. Public, like the survey pages that show it. */
export async function GET(_request: Request, { params }: RouteContext<"/shop-logo/[shopId]">) {
  const { shopId } = await params;
  const logo = await readShopLogo(shopId);
  if (!logo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.contentType,
      // Each upload gets a new ?v=, so a cached copy is never stale.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
