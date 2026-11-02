import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageRequireCapability } from "@/modules/access/page-guards";
import { parseDefinition } from "@/modules/instruments/definition";
import { getInstrument } from "@/modules/instruments/instruments";
import { InstrumentNotFoundError } from "@/modules/instruments/store";
import { listVisibleShops } from "@/modules/shops/shops";
import { SurveyFrame } from "../../survey/shop-header";
import { PreviewSheet } from "./preview-sheet";

export const metadata: Metadata = { title: "Survey preview", robots: { index: false, follow: false } };

/**
 * A survey version exactly as customers see it, one page at a time, for PSG only.
 * Nothing is saved. ?shop= shows a shop's logo and colour.
 */
export default async function SurveyPreviewPage({ params, searchParams }: PageProps<"/survey-preview/[instrumentId]">) {
  await pageRequireCapability("psg.workspace");
  const { instrumentId } = await params;
  const query = await searchParams;
  const found = await getInstrument(instrumentId).catch((error: unknown) => {
    if (error instanceof InstrumentNotFoundError) return null;
    throw error;
  });
  if (!found) notFound();

  const { instrument, versions } = found;
  const version = versions.find((v) => String(v.version) === query.version) ?? versions.find((v) => v.status === "published") ?? versions[0];
  const parsed = version ? parseDefinition(version.definition) : null;
  if (!version || !parsed?.ok) notFound();

  const shops = await listVisibleShops();
  const chosen = shops.find((s) => s.id === query.shop) ?? shops[0];
  const brand = chosen ? { name: chosen.name, logoUrl: chosen.logoUrl, brandColor: chosen.brandColor } : { name: "Your shop", logoUrl: null, brandColor: null };

  return (
    <>
      <form method="get" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-amber-100 px-4 py-2 text-sm text-amber-950">
        <input type="hidden" name="version" value={version.version} />
        <span className="font-medium">
          Preview of {instrument.name}, v{version.version}
          {version.status === "draft" ? " (draft)" : version.isTest ? " (test)" : ""}. Answers are not saved.
        </span>
        {shops.length > 0 && (
          <span className="flex items-center gap-2">
            <label htmlFor="preview-shop">Show as</label>
            <select id="preview-shop" name="shop" defaultValue={chosen?.id} className="rounded border border-amber-300 bg-white px-2 py-1">
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded border border-amber-400 bg-white px-2.5 py-1 font-medium hover:bg-amber-50">
              Show
            </button>
          </span>
        )}
      </form>
      <SurveyFrame shop={brand}>
        <PreviewSheet definition={parsed.definition} />
      </SurveyFrame>
    </>
  );
}
