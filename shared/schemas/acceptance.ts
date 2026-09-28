import { z } from "zod";
import { diskIdSchema } from "./disks";

export const faultAcceptanceInputSchema = z.strictObject({
  attrId: z.string().trim().min(1).max(64),
  note: z.string().max(10_000).optional(),
});

export type FaultAcceptanceInput = z.infer<typeof faultAcceptanceInputSchema>;

export const acceptanceParamsSchema = z.object({
  id: diskIdSchema,
  attrId: z.string().trim().min(1).max(64),
});
