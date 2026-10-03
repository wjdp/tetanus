import {
  replicationParamsSchema,
  replicationQuerySchema,
} from "#shared/schemas/replications";
import { getReplication } from "~~/server/services/replications";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(
    event,
    replicationParamsSchema.parse,
  );
  const query = await getValidatedQuery(event, replicationQuerySchema.parse);
  return await respondWithServiceErrors(async () => getReplication(id, query));
});
