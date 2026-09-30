import { Building2, FileText, Link2, Store, UserRound, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { getPaperFormContext } from "@/modules/responses/staff";
import { listVisibleShops } from "@/modules/shops/shops";
import { PaperForm, PaperLayout, VisitPicker } from "./paper-form";

export const metadata: Metadata = { title: "Enter paper survey" };

export default async function PaperEntryPage({ searchParams }: PageProps<"/psg/responses/paper">) {
  const current = await pageRequireCapability("response.paper_entry");
  const { shop: shopParam, visit: visitParam } = await searchParams;
  const shops = await listVisibleShops();
  const shopId = typeof shopParam === "string" ? shopParam : "";
  const visitId = typeof visitParam === "string" ? visitParam : null;
  const ctx = shopId ? await getPaperFormContext(shopId, visitId) : null;
  const shop = shops.find((s) => s.id === shopId);
  const versionLabel = ctx?.version ? `Survey version ${ctx.version.number}${ctx.version.isTest ? " (TEST)" : ""}` : "No survey version assigned";

  const summary = (
    <>
      <SummaryRow icon={Store} label="Shop" value={shop?.name ?? "Not chosen yet"} aside={shop ? <Link href="/psg/responses/paper" className="text-xs font-medium text-indigo-600 hover:underline">Change</Link> : null} />
      <SummaryRow
        icon={Link2}
        label="Visit"
        value={ctx?.visit ? `${ctx.visit.sourceVisitKey} · ${ctx.visit.customerName}` : "No visit selected"}
        aside={ctx && !ctx.visit ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Pending match</span> : null}
      />
      <SummaryRow icon={FileText} label="Survey version" value={ctx ? versionLabel : "Chosen with the shop"} />
      <SummaryRow icon={UserRound} label="Entered by" value={`${current.name} (you)`} />
    </>
  );

  const shopCard = (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600" aria-hidden="true">
          <Building2 className="size-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-brand-navy-900">Shop &amp; visit</h2>
          <p className="text-sm text-gray-500">Choose the shop and find the visit this survey is for.</p>
        </div>
      </div>
      <form action="/psg/responses/paper" className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="shop" className="text-sm font-medium text-gray-800">
            Shop
          </label>
          <select id="shop" name="shop" defaultValue={shopId} className="h-10 w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 text-sm">
            <option value="">Choose a shop</option>
            {shops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isTestShop && !/internal test/i.test(s.name) ? " (internal test)" : ""}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="h-10 rounded-lg border border-indigo-200 bg-indigo-50 px-4 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100">
          Use this shop
        </button>
      </form>

      {shopId && !ctx && <p className="mt-4 text-sm text-brand-red-dark">That shop or visit could not be found.</p>}
      {ctx && (
        <div className="mt-5 border-t border-gray-100 pt-5">
          <h3 className="sr-only">Visit</h3>
          {ctx.visit ? (
            <div className="text-sm text-gray-700">
              <p>
                <span className="font-mono font-medium text-gray-900">{ctx.visit.sourceVisitKey}</span> · {ctx.visit.customerName}
                {ctx.visit.deliveredOn ? ` · delivered ${ctx.visit.deliveredOn}` : ""}
              </p>
              {ctx.visit.hasCountedResponse && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">This visit already has a counted response. This paper form will go to duplicate review.</p>}
              <Link href={`/psg/responses/paper?shop=${shopId}`} className="mt-2 inline-block text-sm font-medium text-indigo-600 underline-offset-2 hover:underline">
                Choose another visit
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <VisitPicker shopId={shopId} />
              <p className="text-xs text-gray-500">Choose the visit if you know it. Without one, the response is saved as pending customer match.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div>
        <Link href="/psg/responses" className="text-sm text-gray-500 hover:text-brand-navy-900">
          ← Back to Responses
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-navy-900 sm:text-[28px]">Enter paper survey</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">Type the answers exactly as written on the form. They are scored the same way as online answers, and your name is recorded as the person who entered them.</p>
      </div>

      {ctx?.version ? (
        <PaperForm key={`${shopId}-${visitId ?? "none"}`} shopId={shopId} visitId={ctx.visit?.id ?? null} definition={ctx.definition!} versionLabel={versionLabel} lead={shopCard} summary={summary} />
      ) : (
        <PaperLayout step={ctx ? 2 : 1} done={ctx ? 1 : 0} total={2} summary={summary}>
          {shopCard}
          {ctx && !ctx.version && (
            <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">This shop has no survey version assigned. Assign one in the shop settings first.</p>
          )}
        </PaperLayout>
      )}
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value, aside }: { icon: LucideIcon; label: string; value: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="rounded-full bg-gray-100 p-2 text-gray-600" aria-hidden="true">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="truncate text-sm text-gray-900">{value}</p>
      </div>
      {aside}
    </div>
  );
}
