import { datasetParamsSchema } from "#shared/schemas/datasets";
import { getDataset } from "~~/server/services/zfs";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(
    event,
    datasetParamsSchema.parse,
  );
  return await respondWithServiceErrors(async () => getDataset(id));
});
