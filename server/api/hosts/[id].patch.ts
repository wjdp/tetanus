import { hostParamsSchema, hostPatchSchema } from "#shared/schemas/hosts";
import { updateHost } from "~~/server/services/hosts";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, hostParamsSchema.parse);
  const patch = await readValidatedBody(event, hostPatchSchema.parse);
  return await respondWithServiceErrors(async () => updateHost(id, patch));
});
