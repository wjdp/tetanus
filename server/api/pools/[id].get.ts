import { poolParamsSchema } from "#shared/schemas/pools";
import { getPool } from "~~/server/services/zfs";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  return await respondWithServiceErrors(async () => getPool(id));
});
