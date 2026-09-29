import { hostParamsSchema, hostPatchSchema } from "#shared/schemas/hosts";
import { updateHost } from "~~/server/services/hosts";
import { isDemo } from "~~/server/utils/demo";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, hostParamsSchema.parse);
  const patch = await readValidatedBody(event, hostPatchSchema.parse);
  if (isDemo() && patch.healthchecksUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: "Healthchecks is disabled in the demo",
    });
  }
  return await respondWithServiceErrors(async () => updateHost(id, patch));
});
