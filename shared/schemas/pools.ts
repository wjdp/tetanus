import { z } from "zod";

export const poolParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
