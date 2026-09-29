import type { Metadata } from "next";
import Link from "next/link";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { getPaperFormContext } from "@/modules/responses/staff";
import { listVisibleShops } from "@/modules/shops/shops";
import { PaperForm, VisitPicker } from "./paper-form";

export const metadata: Metadata = { title: "Enter paper survey" };

export default async function PaperEntryPage({ searchParams }: PageProps<"/psg/responses/paper">) {
  await pageRequireCapability("response.paper_entry");
  const { shop: shopParam, visit: visitParam } = await searchParams;
  const shops = await listVisibleShops();
  const shopId = typeof shopParam === "string" ? shopParam : "";
  const visitId = typeof visitParam === "string" ? visitParam : null;
  const ctx = shopId ? await getPaperFormContext(shopId, visitId) : null;

  return (
    <div className="max-w-3xl">
      <Link href="/psg/responses" className="text-sm text-gray-500 hover:text-brand-navy-900">
        ← Responses
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-brand-navy-900">Enter paper survey</h1>
      <p className="mt-1 text-sm text-gray-600">Type the answers exactly as written on the form. They are scored the same way as online answers, and your name is recorded as the person who entered them.</p>

      <form action="/psg/responses/paper" className="mt-6 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="shop" className="text-sm font-medium text-gray-700">
            Shop
          </label>
          <select id="shop" name="shop" defaultValue={shopId} className="w-72 max-w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="">Choose a shop</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isTestShop ? " (internal test)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700">
          Use this shop
        </button>
      </form>

      {shopId && !ctx && <p className="mt-6 text-sm text-brand-red-dark">That shop or visit could not be found.</p>}
      {ctx && (
        <div className="mt-6 flex flex-col gap-6">
          <section aria-labelledby="visit-heading" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="visit-heading" className="text-base font-semibold text-brand-navy-900">
              Visit
            </h2>
            {ctx.visit ? (
              <div className="mt-2 text-sm text-gray-700">
                <p>
                  <span className="font-mono">{ctx.visit.sourceVisitKey}</span> · {ctx.visit.customerName}
                  {ctx.visit.deliveredOn ? ` · delivered ${ctx.visit.deliveredOn}` : ""}
                </p>
                {ctx.visit.hasCountedResponse && <p className="mt-1 text-amber-800">This visit already has a counted response. This paper form will go to duplicate review.</p>}
                <Link href={`/psg/responses/paper?shop=${shopId}`} className="mt-2 inline-block text-brand-navy-900 underline-offset-2 hover:underline">
                  Choose another visit
                </Link>
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-3">
                <p className="text-sm text-gray-600">Choose the visit if you know it. Without one, the response is saved as pending customer match.</p>
                <VisitPicker shopId={shopId} />
              </div>
            )}
          </section>

          <section aria-labelledby="answers-heading" className="rounded-xl border border-gray-200 bg-white p-5">
            <h2 id="answers-heading" className="text-base font-semibold text-brand-navy-900">
              Answers
            </h2>
            {ctx.version ? (
              <>
                <p className="mt-1 text-xs text-gray-500">
                  Survey version {ctx.version.number}
                  {ctx.version.isTest ? " (TEST)" : ""}
                </p>
                <div className="mt-4">
                  <PaperForm key={`${shopId}-${visitId ?? "none"}`} shopId={shopId} visitId={ctx.visit?.id ?? null} definition={ctx.definition!} />
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-gray-600">This shop has no survey version assigned. Assign one in the shop settings first.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
