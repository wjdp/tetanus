import { plainPageQuerySchema } from "#shared/schemas/page";
import { poolParamsSchema } from "#shared/schemas/pools";
import { listPoolDiary } from "~~/server/services/zfs";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  const query = await getValidatedQuery(event, plainPageQuerySchema.parse);
  return await respondWithServiceErrors(async () => listPoolDiary(id, query));
});
