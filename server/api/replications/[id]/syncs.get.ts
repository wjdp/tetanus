import { plainPageQuerySchema } from "#shared/schemas/page";
import { replicationParamsSchema } from "#shared/schemas/replications";
import { listReplicationSyncs } from "~~/server/services/replications";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(
    event,
    replicationParamsSchema.parse,
  );
  const query = await getValidatedQuery(event, plainPageQuerySchema.parse);
  return await respondWithServiceErrors(async () =>
    listReplicationSyncs(id, query),
  );
});
