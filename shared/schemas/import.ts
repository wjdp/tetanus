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

export type ScrutinyMatch = "wwn" | "uuid" | "serial" | "created";

// TDate is Date on the server and string once serialised to the client.
export interface ScrutinyDeviceImport<TDate = Date> {
  key: string;
  model: string;
  serial: string;
  matched: ScrutinyMatch;
  diskId: number | null;
  cutoff: TDate | null;
  readings: number;
  temperatures: number;
  skipped: number;
  error?: string;
}

export interface ScrutinyImportResult<TDate = Date> {
  dryRun: boolean;
  devices: ScrutinyDeviceImport<TDate>[];
}
