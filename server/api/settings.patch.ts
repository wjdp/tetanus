import { settingsPatchSchema } from "#shared/schemas/settings";
import { maskSettings, updateSettings } from "~~/server/services/settings";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const patch = await readValidatedBody(event, settingsPatchSchema.parse);
  return maskSettings(
    await respondWithServiceErrors(async () => updateSettings(patch)),
  );
});
