import { faultParamsSchema } from "#shared/schemas/faults";
import { performFaultAction } from "~~/server/services/faults";
import { respondWithServiceErrors } from "~~/server/utils/respondWithServiceErrors";

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, faultParamsSchema.parse);
  return await respondWithServiceErrors(async () =>
    performFaultAction(id, "clear"),
  );
});
