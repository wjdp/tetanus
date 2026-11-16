import {
  poolHistoryQuerySchema,
  poolParamsSchema,
} from "#shared/schemas/pools";
import { listPoolHistory } from "~~/server/services/zfs";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  const query = await getValidatedQuery(event, poolHistoryQuerySchema.parse);
  return await respondWithServiceErrors(async () => listPoolHistory(id, query));
});
