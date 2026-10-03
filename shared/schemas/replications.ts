import { z } from "zod";

export const replicationParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const replicationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export type ReplicationQuery = z.infer<typeof replicationQuerySchema>;
