import { z } from "zod";

export const MAX_IMPORT_BYTES = 1024 * 1024;

export const obsidianImportSchema = z.strictObject({
  text: z
    .string()
    .refine(
      (text) => new TextEncoder().encode(text).length <= MAX_IMPORT_BYTES,
      "The pasted table must be 1 MiB or smaller",
    ),
  dryRun: z.boolean(),
});

export type ObsidianImportInput = z.infer<typeof obsidianImportSchema>;
