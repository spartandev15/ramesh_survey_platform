import { z } from "zod";

export const instrumentInputSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{2,62}$/, "Use 3 to 63 lowercase letters, numbers or underscores, starting with a letter"),
  name: z.string().trim().min(2, "Enter the survey name").max(120),
  description: z.string().trim().max(1000).optional(),
});

export type InstrumentInput = z.infer<typeof instrumentInputSchema>;
