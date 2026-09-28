import { datasetSearchQuerySchema } from "#shared/schemas/datasets";
import { searchDatasets } from "~~/server/services/zfs";

export default defineEventHandler(async (event) => {
  const { q } = await getValidatedQuery(event, datasetSearchQuerySchema.parse);
  return { datasets: searchDatasets(q) };
});
