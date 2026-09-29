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
