"use client";

import { useEffect, useRef, useState } from "react";
import { textOn } from "@/lib/contrast";

const brand = (brandColor: string | null) => (brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : "#001c3d");

/** The bar across the top of a survey page in the shop's colour (SR-02). Brand colours outside #rrggbb are ignored. */
export function ShopHeader({ name, brandColor }: { name: string; brandColor: string | null }) {
  const color = brand(brandColor);
  return (
    <header style={{ backgroundColor: color, color: textOn(color) }} className="px-4 py-2.5">
      <p className="mx-auto max-w-4xl truncate text-right text-sm font-medium">{name}</p>
    </header>
  );
}

/**
 * The sending shop's logo, centred at the top of the survey card (SR-02). A logo
 * that fails to load falls back to the shop name (AT-02).
 */
export function ShopBrand({ name, logoUrl }: { name: string; logoUrl: string | null; brandColor?: string | null }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = useRef<HTMLImageElement>(null);
  const showLogo = logoUrl && !logoFailed;

  // A logo can fail before the page is interactive, when onError is not listening yet.
  useEffect(() => {
    const img = logo.current;
    if (img?.complete && img.naturalWidth === 0) setLogoFailed(true);
  }, []);

  return (
    <div data-shop-brand className="flex justify-center px-4 py-5">
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- shop logos are uploaded or admin-configured URLs on any host
        <img ref={logo} src={logoUrl} alt={name} referrerPolicy="no-referrer" onError={() => setLogoFailed(true)} className="h-16 w-auto max-w-64 object-contain sm:h-20 sm:max-w-80" />
      ) : (
        <p className="text-center text-2xl font-semibold text-brand-navy-900">{name}</p>
      )}
    </div>
  );
}

/** A customer survey page: the shop's bar, then one white card with the logo on top. */
export function SurveyFrame({ shop, test, children }: { shop: { name: string; logoUrl: string | null; brandColor: string | null }; test?: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface">
      <ShopHeader name={shop.name} brandColor={shop.brandColor} />
      {test && <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">Test survey for internal testing only. Answers are test data and never count in reports.</p>}
      <main className="mx-auto max-w-4xl px-3 py-6 sm:px-4 sm:py-10">
        <div className="rounded-lg bg-white px-5 pb-8 shadow-md sm:px-10">
          <ShopBrand name={shop.name} logoUrl={shop.logoUrl} />
          {children}
        </div>
      </main>
    </div>
  );
}
