import { z } from "zod";

export const createStreamSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  embedUrl: z
    .string()
    .trim()
    .url("A valid http(s) URL is required")
    .refine((u) => /^https?:\/\//i.test(u), "URL must be http or https"),
});

export const updateStreamSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.enabled !== undefined, {
    message: "Nothing to update",
  });

export type CreateStreamInput = z.infer<typeof createStreamSchema>;
export type UpdateStreamInput = z.infer<typeof updateStreamSchema>;
