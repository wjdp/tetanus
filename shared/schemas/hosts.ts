import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

export const hostPatchSchema = z.strictObject({
  displayName: optionalText(100).optional(),
  healthchecksUrl: z
    .union([
      z.url({ protocol: /^https?$/ }),
      z.literal("").transform(() => null),
    ])
    .nullable()
    .optional(),
  notes: z.string().max(100_000).optional(),
});

export type HostPatch = z.infer<typeof hostPatchSchema>;

export const hostIdSchema = z.coerce.number().int().positive();
