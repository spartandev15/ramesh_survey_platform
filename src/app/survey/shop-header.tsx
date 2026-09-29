"use client";

import { useEffect, useRef, useState } from "react";

/** Readable text colour for a brand background (WCAG relative luminance). */
function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#111827" : "#ffffff";
}

/**
 * The sending shop's identity (SR-02). A logo that fails to load falls back to
 * the shop name (AT-02). Brand colours outside #rrggbb are ignored.
 */
export function ShopHeader({ name, logoUrl, brandColor }: { name: string; logoUrl: string | null; brandColor: string | null }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const logo = useRef<HTMLImageElement>(null);
  const color = brandColor && /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : "#001c3d";
  const showLogo = logoUrl && !logoFailed;

  // A logo can fail before the page is interactive, when onError is not listening yet.
  useEffect(() => {
    const img = logo.current;
    if (img?.complete && img.naturalWidth === 0) setLogoFailed(true);
  }, []);

  return (
    <header style={{ backgroundColor: color, color: textOn(color) }} className="px-4 py-5">
      <div className="mx-auto flex max-w-2xl items-center gap-4">
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- shop logos are admin-configured URLs on any host
          <img ref={logo} src={logoUrl} alt={name} referrerPolicy="no-referrer" onError={() => setLogoFailed(true)} className="h-12 w-auto max-w-48 rounded bg-white/90 object-contain p-1" />
        ) : (
          <p className="text-xl font-semibold">{name}</p>
        )}
      </div>
    </header>
  );
}
