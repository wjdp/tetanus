import { z } from "zod";

export const datasetParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const datasetSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

export type DatasetSearchQuery = z.infer<typeof datasetSearchQuerySchema>;
