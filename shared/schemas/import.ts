import { z } from "zod";

export const SCRUTINY_DEFAULT_URL = "https://scrutiny.wjdp.uk";

export const scrutinyImportTaskPayloadSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  hostId: z.number().int().positive(),
});

export const scrutinyImportSchema = scrutinyImportTaskPayloadSchema.extend({
  dryRun: z.boolean(),
});

export type ScrutinyImportBody = z.infer<typeof scrutinyImportSchema>;

export const scrutinyImportResultParamsSchema = z.object({
  taskId: z.coerce.number().int().positive(),
});
