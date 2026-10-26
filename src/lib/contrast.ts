/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Pure black, not a softer grey: with black or white, every colour reaches at least 4.58:1 (AA).
const DARK = "#000000";
const LIGHT = "#ffffff";

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of dark or white text reads better on a shop's brand colour (SR-02, SR-39). */
export function textOn(background: string): string {
  return contrastRatio(background, DARK) >= contrastRatio(background, LIGHT) ? DARK : LIGHT;
}
