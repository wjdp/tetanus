import { diskParamsSchema } from "#shared/schemas/disks";
import { getDiskStatistics } from "~~/server/services/statistics";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diskParamsSchema.parse);
  return await respondWithServiceErrors(async () => getDiskStatistics(id));
});
