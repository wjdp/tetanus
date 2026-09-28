import { z } from "zod";
import { TASK_NAMES } from "../tasks";

export const taskPayloadSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

export const runTaskBodySchema = z.object({
  taskName: z.enum(TASK_NAMES),
  payload: taskPayloadSchema.optional(),
});
