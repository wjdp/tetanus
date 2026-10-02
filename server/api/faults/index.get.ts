import { faultsQuerySchema } from "#shared/schemas/faults";
import { listFaults } from "~~/server/services/faults";

export default defineEventHandler(async (event) => {
  const query = await getValidatedQuery(event, faultsQuerySchema.parse);
  return listFaults(query);
});
