import { hostParamsSchema } from "#shared/schemas/hosts";
import { listHostBays } from "~~/server/services/locations";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, hostParamsSchema.parse);
  return await respondWithServiceErrors(async () => listHostBays(id));
});
