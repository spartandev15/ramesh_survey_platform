import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { loadPublicForm } from "@/modules/responses/public-form";
import { ShopHeader } from "../../shop-header";
import { PublicSurveyForm } from "./public-form";

export const metadata: Metadata = { title: "Customer survey", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Public shop survey URL/QR (SR-13): the shop is fixed by the URL, and no customer data is shown. */
export default async function PublicShopSurveyPage({ params }: PageProps<"/survey/shop/[slug]">) {
  const { slug } = await params;
  const form = await loadPublicForm(slug);

  if (!form) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="flex justify-center">
            <Link2Off aria-hidden="true" className="size-8 text-gray-500" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-brand-navy-900">This survey is not available</h1>
          <p className="mt-2 text-gray-600">Check the link or QR code. If it still does not work, please contact the shop.</p>
        </div>
      </main>
    );
  }
  return (
    <div className="min-h-screen bg-surface">
      <ShopHeader name={form.shop.name} logoUrl={form.shop.logoUrl} brandColor={form.shop.brandColor} />
      {form.isTest && <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">Test survey for internal testing only. Answers are test data and never count in reports.</p>}
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="rounded-2xl bg-white p-5 shadow-sm sm:p-8">
          <PublicSurveyForm slug={slug} versionId={form.versionId} additionVersionId={form.additionVersionId} shopName={form.shop.name} definition={form.definition} />
        </div>
      </main>
    </div>
  );
}
