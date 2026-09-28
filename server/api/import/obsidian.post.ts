import { obsidianImportSchema } from "#shared/schemas/import";
import { importObsidian } from "~~/server/services/importers/obsidian";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, obsidianImportSchema.parse);
  return await respondWithServiceErrors(async () => importObsidian(input));
});
