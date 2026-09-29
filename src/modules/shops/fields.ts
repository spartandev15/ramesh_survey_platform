/**
 * Shop helpers the PSG shop forms also use in the browser. Kept apart from the
 * validation schemas so those pages do not download the validation library.
 */
import type { ShopMode } from "./settings-policy";

export const MODE_LABELS: Record<ShopMode, string> = { test: "Test", live: "Live", paused: "Paused" };

/** Suggest a public slug from a shop name, e.g. "Joe's Body Shop" -> "joes-body-shop". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];
