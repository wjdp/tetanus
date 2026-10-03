import { poolParamsSchema } from "#shared/schemas/pools";
import { datasetReplications } from "~~/server/services/replications";
import { listDatasets } from "~~/server/services/zfs";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, poolParamsSchema.parse);
  return await respondWithServiceErrors(async () => {
    const datasets = listDatasets(id);
    const replications = datasetReplications(datasets.map((row) => row.id));
    return {
      datasets: datasets.map((row) => ({
        ...row,
        replications: replications.get(row.id) ?? [],
      })),
    };
  });
});
