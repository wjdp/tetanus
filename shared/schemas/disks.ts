import { z } from "zod";
import { DISPOSAL_KINDS, type Disposal, STATE_OVERRIDES } from "../disk";
import { inventorySchema } from "../inventory-fields";

const DAY_MS = 24 * 60 * 60 * 1000;

export const diskIdSchema = z.coerce.number().int().positive();

export const diskParamsSchema = z.object({ id: diskIdSchema });

export const diskAliasSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9._-]*$/, "Alias may only contain letters, digits, . _ -")
  .transform((value) => (value === "" ? null : value));

function latestDisposalDay() {
  return new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
}

export const disposalSchema = z
  .strictObject({
    kind: z.enum(DISPOSAL_KINDS),
    on: z.iso
      .date()
      .refine(
        (on) => on <= latestDisposalDay(),
        "Disposal date cannot be in the future",
      ),
    salePrice: z.number().positive().optional(),
  })
  .refine(
    (disposal) => disposal.salePrice === undefined || disposal.kind === "sold",
    { path: ["salePrice"], message: "Only a sold disk has a sale price" },
  ) satisfies z.ZodType<Disposal>;

export const diskPatchSchema = z.strictObject({
  alias: diskAliasSchema.nullable().optional(),
  notes: z.string().max(100_000).optional(),
  stateOverride: z.enum(STATE_OVERRIDES).nullable().optional(),
  inventory: inventorySchema.optional(),
  disposal: disposalSchema.nullable().optional(),
  replacesDiskId: z.number().int().positive().nullable().optional(),
});

export type DiskPatch = z.infer<typeof diskPatchSchema>;
