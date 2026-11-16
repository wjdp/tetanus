import { z } from "zod";

export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 1000;

const pageShape = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
  beforeAt: z.coerce.number().int().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
};

export interface PageCursor {
  beforeAt?: number;
  beforeId?: number;
}

/**
 * A newest-first page query: `limit` rows older than the (`beforeAt`, `beforeId`)
 * cursor, which is the `at` and `id` of the last row already shown.
 */
export function pageQuerySchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.object({ ...shape, ...pageShape }).refine(
    (query) => {
      const { beforeAt, beforeId } = query as PageCursor;
      return (beforeAt === undefined) === (beforeId === undefined);
    },
    { message: "beforeAt and beforeId go together" },
  );
}

export const plainPageQuerySchema = pageQuerySchema({});
export type PageQuery = z.infer<typeof plainPageQuerySchema>;
