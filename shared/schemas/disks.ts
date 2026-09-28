import { z } from "zod";
import { STATE_OVERRIDES } from "../disk";
import { inventorySchema } from "../inventory-fields";

export const diskIdSchema = z.coerce.number().int().positive();

export const diskParamsSchema = z.object({ id: diskIdSchema });

export const diskAliasSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[A-Za-z0-9._-]*$/, "Alias may only contain letters, digits, . _ -")
  .transform((value) => (value === "" ? null : value));

export const diskPatchSchema = z.strictObject({
  alias: diskAliasSchema.nullable().optional(),
  notes: z.string().max(100_000).optional(),
  stateOverride: z.enum(STATE_OVERRIDES).nullable().optional(),
  inventory: inventorySchema.optional(),
});

export type DiskPatch = z.infer<typeof diskPatchSchema>;
