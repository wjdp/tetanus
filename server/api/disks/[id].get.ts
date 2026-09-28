import { diskParamsSchema } from "#shared/schemas/disks";
import { getDisk } from "~~/server/services/disks";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diskParamsSchema.parse);
  return await respondWithServiceErrors(() => getDisk(id));
});
