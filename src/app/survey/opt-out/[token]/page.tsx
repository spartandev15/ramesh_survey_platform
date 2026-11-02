import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { loadOptOutPage } from "@/modules/email-ledger/public";
import { SurveyFrame } from "../../shop-header";
import { OptOutForm } from "./opt-out-form";

export const metadata: Metadata = { title: "Survey emails", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Shop-only opt-out (SR-25). Opening the page changes nothing; the button does. */
export default async function OptOutPage({ params }: PageProps<"/survey/opt-out/[token]">) {
  const { token } = await params;
  const page = await loadOptOutPage(token);

  if (!page) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <div className="flex justify-center">
            <Link2Off aria-hidden="true" className="size-8 text-gray-500" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-brand-navy-900">This link is not valid</h1>
          <p className="mt-2 text-gray-600">Check that the whole link was copied. If it still does not work, contact the shop that emailed you.</p>
        </div>
      </main>
    );
  }
  return (
    <SurveyFrame shop={{ name: page.shopName, logoUrl: page.logoUrl, brandColor: page.brandColor }}>
      <OptOutForm token={token} shopName={page.shopName} />
    </SurveyFrame>
  );
}
