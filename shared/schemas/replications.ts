import { z } from "zod";

export const replicationParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const replicationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export type ReplicationQuery = z.infer<typeof replicationQuerySchema>;

const DAY_SEC = 24 * 60 * 60;

export const replicationPatchSchema = z
  .strictObject({
    sourceDatasetId: z.number().int().positive().nullable().optional(),
    manualIntervalSec: z
      .number()
      .int()
      .min(60)
      .max(366 * DAY_SEC)
      .nullable()
      .optional(),
    archived: z.boolean().optional(),
    archivedNote: z.string().trim().max(10_000).optional(),
  })
  .refine(
    (patch) => patch.archivedNote === undefined || patch.archived === true,
    {
      message: "archivedNote goes with archived: true",
      path: ["archivedNote"],
    },
  );

export type ReplicationPatch = z.infer<typeof replicationPatchSchema>;
