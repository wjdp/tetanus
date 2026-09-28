import { datasetSearchQuerySchema } from "#shared/schemas/datasets";
import { lookupDatasets, searchDatasets } from "~~/server/services/zfs";

export default defineEventHandler(async (event) => {
  const { q, ids } = await getValidatedQuery(
    event,
    datasetSearchQuerySchema.parse,
  );
  return { datasets: ids ? lookupDatasets(ids) : searchDatasets(q ?? "") };
});
