import { z } from "zod";

export const shopInputSchema = z.object({
  name: z.string().trim().min(2, "Enter the shop name").max(120),
  publicSlug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Use at least 3 characters")
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens"),
  timezone: z.string().trim().min(1, "Choose a timezone"),
  isTestShop: z.boolean(),
});

export type ShopInput = z.infer<typeof shopInputSchema>;

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
