import { z } from "zod";

export const datasetParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const MAX_LOOKUP_IDS = 100;

const idList = z
  .string()
  .transform((value) => value.split(",").map(Number))
  .pipe(z.array(z.number().int().positive()).min(1).max(MAX_LOOKUP_IDS));

export const datasetSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    ids: idList.optional(),
  })
  .refine(
    (query) => query.q !== undefined || query.ids !== undefined,
    "Provide q or ids",
  );

export type DatasetSearchQuery = z.infer<typeof datasetSearchQuerySchema>;
