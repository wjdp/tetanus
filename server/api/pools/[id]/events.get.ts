import { poolEventsQuerySchema, poolParamsSchema } from "#shared/schemas/pools";
import { listPoolEvents } from "~~/server/services/zfs";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  const query = await getValidatedQuery(event, poolEventsQuerySchema.parse);
  return await respondWithServiceErrors(async () => listPoolEvents(id, query));
});
