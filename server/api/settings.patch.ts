import { settingsPatchSchema } from "#shared/schemas/settings";
import { updateSettings } from "~~/server/services/settings";

export default defineEventHandler(async (event) => {
  const patch = await readValidatedBody(event, settingsPatchSchema.parse);
  return await updateSettings(patch);
});
