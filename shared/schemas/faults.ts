import { z } from "zod";
import {
  FAULT_CATEGORIES,
  FAULT_SEVERITIES,
  FAULT_STATES,
  FAULT_SUBJECT_TYPES,
  LIVE_FAULT_STATES,
} from "../faults";

const stateList = z
  .string()
  .transform((value) => value.split(",").filter(Boolean))
  .pipe(z.array(z.enum(FAULT_STATES)).min(1));

const subject = z
  .string()
  .regex(new RegExp(`^(${FAULT_SUBJECT_TYPES.join("|")}):\\d+$`))
  .transform((value) => {
    const [type, id] = value.split(":");
    return {
      type: type as (typeof FAULT_SUBJECT_TYPES)[number],
      id: Number(id),
    };
  });

export const faultsQuerySchema = z.object({
  state: stateList.default([...LIVE_FAULT_STATES]),
  category: z.enum(FAULT_CATEGORIES).optional(),
  severity: z.enum(FAULT_SEVERITIES).optional(),
  host: z.string().trim().min(1).max(200).optional(),
  subject: subject.optional(),
  namesDisk: z.coerce.number().int().positive().optional(),
});

export type FaultsQuery = z.infer<typeof faultsQuerySchema>;

export const faultParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const faultActionInputSchema = z
  .strictObject({ note: z.string().max(10_000).optional() })
  .default({});

export type FaultActionInput = z.infer<typeof faultActionInputSchema>;
