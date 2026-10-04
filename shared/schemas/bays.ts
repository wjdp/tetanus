import { z } from "zod";

const label = z
  .string()
  .trim()
  .max(100)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const bayPatchSchema = z
  .record(z.string().min(1).max(512), label)
  .refine((patch) => Object.keys(patch).length <= 512, "Too many bays");

export type BayPatch = z.infer<typeof bayPatchSchema>;
