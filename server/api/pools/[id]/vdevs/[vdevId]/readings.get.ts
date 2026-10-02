import { vdevParamsSchema } from "#shared/schemas/pools";
import { getVdevReadings } from "~~/server/services/zfs";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id, vdevId } = await getValidatedRouterParams(
    event,
    vdevParamsSchema.parse,
  );
  return await respondWithServiceErrors(async () =>
    getVdevReadings(id, vdevId),
  );
});
