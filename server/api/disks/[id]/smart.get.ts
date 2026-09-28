import { diskParamsSchema } from "#shared/schemas/disks";
import { smartQuerySchema } from "#shared/schemas/smart";
import { getSmartOverview } from "~~/server/services/smart";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, diskParamsSchema.parse);
  const { range } = await getValidatedQuery(event, smartQuerySchema.parse);
  return await respondWithServiceErrors(async () =>
    getSmartOverview(id, range),
  );
});
