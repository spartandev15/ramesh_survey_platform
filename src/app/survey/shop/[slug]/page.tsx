import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { loadPublicForm } from "@/modules/responses/public-form";
import { SurveyFrame } from "../../shop-header";
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
    <SurveyFrame shop={form.shop} test={form.isTest}>
      <PublicSurveyForm slug={slug} versionId={form.versionId} additionVersionId={form.additionVersionId} shopName={form.shop.name} definition={form.definition} />
    </SurveyFrame>
  );
}
