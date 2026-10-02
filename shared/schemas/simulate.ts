import { z } from "zod";
import { SIMULATION_SUBJECT_TYPES } from "../simulator";

export const simulationSubjectParamsSchema = z.object({
  subjectType: z.enum(SIMULATION_SUBJECT_TYPES),
  id: z.coerce.number().int().positive(),
});

export const simulateInputSchema = z.strictObject({
  scenario: z.string().min(1).max(100),
  params: z
    .record(z.string(), z.union([z.string().max(200), z.number()]))
    .default({}),
});

export type SimulateInput = z.infer<typeof simulateInputSchema>;
