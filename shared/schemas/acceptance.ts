import { z } from "zod";
import { ACCEPTANCE_KINDS } from "../smart/status";
import { diskIdSchema } from "./disks";

export const faultAcceptanceInputSchema = z.strictObject({
  attrId: z.string().trim().min(1).max(64),
  kind: z.enum(ACCEPTANCE_KINDS).default("accept"),
  note: z.string().max(10_000).optional(),
});

export type FaultAcceptanceInput = z.infer<typeof faultAcceptanceInputSchema>;

export const acceptanceParamsSchema = z.object({
  id: diskIdSchema,
  attrId: z.string().trim().min(1).max(64),
});
