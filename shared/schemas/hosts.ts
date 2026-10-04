import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable();

const celsius = z.number().int().min(0).max(120);

const temperaturePairSchema = z
  .strictObject({ warning: celsius, error: celsius })
  .refine(({ warning, error }) => warning < error, {
    message: "Warning must be below error",
    path: ["warning"],
  });

export const temperatureThresholdsSchema = z
  .strictObject({
    hdd: temperaturePairSchema.optional(),
    ssd: temperaturePairSchema.optional(),
    sustainedMinutes: z.number().int().min(0).max(1440).optional(),
  })
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
  intermittent: z.boolean().optional(),
  notes: z.string().max(100_000).optional(),
  temperatureThresholds: temperatureThresholdsSchema.optional(),
});

export type HostPatch = z.infer<typeof hostPatchSchema>;

export const hostIdSchema = z.coerce.number().int().positive();

export const hostOrderSchema = z.strictObject({
  hostIds: z
    .array(hostIdSchema)
    .refine((ids) => new Set(ids).size === ids.length, "Duplicate host id"),
});

export type HostOrder = z.infer<typeof hostOrderSchema>;

export const hostParamsSchema = z.object({ id: hostIdSchema });
