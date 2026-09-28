import { settingsPatchSchema } from "#shared/schemas/settings";
import { updateSettings } from "~~/server/services/settings";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const patch = await readValidatedBody(event, settingsPatchSchema.parse);
  return await respondWithServiceErrors(async () => updateSettings(patch));
});
