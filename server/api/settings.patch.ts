import { settingsPatchSchema } from "#shared/schemas/settings";
import { updateSettings } from "~~/server/services/settings";
import { isDemo, presentSettings } from "~~/server/utils/demo";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const patch = await readValidatedBody(event, settingsPatchSchema.parse);
  if (isDemo() && patch.config.notifications !== undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: "Notification channels are disabled in the demo",
    });
  }
  return presentSettings(
    await respondWithServiceErrors(async () => updateSettings(patch)),
  );
});
